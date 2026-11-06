import "server-only";
import {
  deleteIntegrationAccount,
  deleteIntegrationAuthorization,
  getIntegrationAccount,
  getIntegrationAuthorization,
  getIntegrationConnection,
  getIntegrationOauthClient,
  listIntegrations,
  markIntegrationNeedsReconnect,
  saveIntegrationAccount,
  saveIntegrationAuthorization,
  storeIntegrationAccessToken,
} from "@/lib/db/integrations";
import {
  IntegrationError,
  IntegrationReconnectError,
} from "@/lib/integrations/errors";
import {
  createAuthorizationSecrets,
  exchangeAuthorizationCode,
  fetchCalendarAddress,
  fetchGmailAddress,
  googleAuthorizationUrl,
  parseAuthorizationResponse,
  refreshAccessToken,
  revokeToken,
  type GoogleOauthClient,
} from "@/lib/integrations/google/oauth";
import {
  grantedIntegrations,
  INTEGRATIONS,
  type Integration,
  type IntegrationId,
  type IntegrationProvider,
} from "@/lib/integrations/schema";

/** Google's codes last minutes; a sign-in left open longer starts over. */
const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

/** Refresh early so a token never expires partway through a request. */
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

/** How each integration learns which account a new sign-in belongs to. */
const ACCOUNT_EMAIL: Record<
  IntegrationId,
  (accessToken: string) => Promise<string>
> = {
  gmail: fetchGmailAddress,
  calendar: fetchCalendarAddress,
};

function requireOauthClient(provider: IntegrationProvider): GoogleOauthClient {
  const client = getIntegrationOauthClient(provider);
  if (!client) {
    throw new IntegrationError(
      "An administrator has not set up Google access on this server.",
      409,
      "not_configured",
    );
  }
  return { clientId: client.clientId, clientSecret: client.clientSecret };
}

/**
 * Begins a sign-in that asks for the chosen integrations, and returns the
 * Google page the user approves it on.
 */
export function startIntegrationAuthorization(
  userId: string,
  provider: IntegrationProvider,
  integrationIds: readonly IntegrationId[],
): { url: string } {
  const client = requireOauthClient(provider);
  const scopes = new Set<string>();
  for (const id of integrationIds) {
    if (INTEGRATIONS[id].provider !== provider) {
      throw new IntegrationError("That cannot be connected here.", 400);
    }
    for (const scope of INTEGRATIONS[id].scopes) scopes.add(scope);
  }
  if (scopes.size === 0) {
    throw new IntegrationError("Choose at least one thing to connect.", 400);
  }
  const secrets = createAuthorizationSecrets();
  saveIntegrationAuthorization({ userId, provider, ...secrets });
  return {
    url: googleAuthorizationUrl({
      clientId: client.clientId,
      scopes: [...scopes],
      ...secrets,
      // Reconnecting is routine where Google limits a sign-in to a week.
      loginHint: getIntegrationAccount(userId, provider)?.accountEmail,
    }),
  };
}

/**
 * Finishes a sign-in from the address the user's browser ended on. The user
 * may have unticked permissions on Google's page, so the sign-in is kept when
 * it covers at least one integration, and it replaces any earlier one.
 */
export async function completeIntegrationAuthorization(
  userId: string,
  provider: IntegrationProvider,
  redirectUrl: string,
): Promise<Integration[]> {
  const client = requireOauthClient(provider);
  const { code, state } = parseAuthorizationResponse(redirectUrl);

  const pending = getIntegrationAuthorization(userId, provider);
  if (!pending) {
    throw new IntegrationError(
      "This sign-in was already used or never started. Start again.",
      400,
    );
  }
  if (Date.now() - pending.createdAt.getTime() > AUTHORIZATION_TTL_MS) {
    deleteIntegrationAuthorization(userId, provider);
    throw new IntegrationError("This sign-in expired. Start again.", 400);
  }
  if (pending.state !== state) {
    // Keep the pending sign-in: the right address may still be pasted.
    throw new IntegrationError(
      "That address is from a different sign-in. Paste the address from the tab that just opened, or start again.",
      400,
    );
  }
  // A code works once, so the sign-in is spent whatever Google answers.
  deleteIntegrationAuthorization(userId, provider);

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode(client, {
      code,
      codeVerifier: pending.codeVerifier,
    });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "invalid_grant") {
      throw new IntegrationError(
        "Google no longer accepts that sign-in code. Start again.",
        400,
      );
    }
    throw error;
  }

  const previous = getIntegrationAccount(userId, provider);
  // Google may treat withdrawing one sign-in as withdrawing the account's
  // whole approval of this client, which would end a sign-in the user still
  // relies on. An unusable sign-in is withdrawn only when there is no other.
  const discard = async () => {
    if (!previous) await revokeToken(tokens.refreshToken ?? tokens.accessToken);
  };

  const granted = grantedIntegrations(provider, tokens.scopes);
  if (granted.length === 0 || !tokens.refreshToken) {
    await discard();
    throw new IntegrationError(
      granted.length === 0
        ? "Google did not grant the access OvertChat asked for. Start again and keep the checkboxes on Google's page ticked."
        : "Google did not issue a lasting sign-in. Start again.",
      400,
    );
  }

  let accountEmail: string;
  try {
    accountEmail = await ACCOUNT_EMAIL[granted[0]](tokens.accessToken);
  } catch (error) {
    await discard();
    throw error;
  }

  saveIntegrationAccount({
    userId,
    provider,
    accountEmail,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    scopes: tokens.scopes,
  });
  // A different account's earlier sign-in would otherwise stay live.
  if (previous && previous.accountEmail !== accountEmail) {
    await revokeToken(previous.refreshToken);
  }
  return listIntegrations(userId).filter(
    (integration) => integration.provider === provider,
  );
}

/** Ends the user's sign-in to a provider, and with it every integration on it. */
export async function disconnectIntegrationAccount(
  userId: string,
  provider: IntegrationProvider,
): Promise<void> {
  deleteIntegrationAuthorization(userId, provider);
  const removed = deleteIntegrationAccount(userId, provider);
  if (removed) await revokeToken(removed.refreshToken);
}

/**
 * Forgets an access token Google has just refused, so the next request
 * refreshes it and learns whether the grant itself is still alive.
 */
export function discardIntegrationAccessToken(
  userId: string,
  integrationId: IntegrationId,
  accessToken: string,
): void {
  const connection = getIntegrationConnection(userId, integrationId);
  if (connection?.accessToken !== accessToken) return;
  storeIntegrationAccessToken({
    userId,
    provider: connection.provider,
    refreshToken: connection.refreshToken,
    accessToken,
    accessTokenExpiresAt: new Date(0),
  });
}

const refreshes = new Map<string, Promise<string>>();

/**
 * A token the caller can use right now. A grant Google has withdrawn is marked
 * so Settings can ask for a new sign-in, and reported as
 * `IntegrationReconnectError`.
 */
export async function getIntegrationAccessToken(
  userId: string,
  integrationId: IntegrationId,
): Promise<string> {
  const connection = getIntegrationConnection(userId, integrationId);
  if (!connection) {
    throw new IntegrationError(
      "This account is not connected.",
      409,
      "not_connected",
    );
  }
  if (connection.status === "needs_reconnect") {
    throw new IntegrationReconnectError();
  }
  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() - Date.now() >
      ACCESS_TOKEN_MARGIN_MS
  ) {
    return connection.accessToken;
  }

  const { provider } = INTEGRATIONS[integrationId];
  const client = requireOauthClient(provider);
  // Concurrent tool calls share one refresh.
  const key = `${userId}\u0000${provider}\u0000${connection.refreshToken}`;
  const running = refreshes.get(key);
  if (running) return running;

  const refresh = (async () => {
    const guard = {
      userId,
      provider,
      refreshToken: connection.refreshToken,
    };
    try {
      const tokens = await refreshAccessToken(client, connection.refreshToken);
      storeIntegrationAccessToken({
        ...guard,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      });
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof IntegrationError && error.code === "invalid_grant") {
        markIntegrationNeedsReconnect(guard);
        throw new IntegrationReconnectError();
      }
      throw error;
    }
  })().finally(() => refreshes.delete(key));
  refreshes.set(key, refresh);
  return refresh;
}
