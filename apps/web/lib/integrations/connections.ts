import "server-only";
import {
  deleteIntegrationAuthorization,
  deleteIntegrationConnection,
  getIntegration,
  getIntegrationAuthorization,
  getIntegrationConnection,
  getIntegrationOauthClient,
  integrationConnectionStatus,
  markIntegrationNeedsReconnect,
  saveIntegrationAuthorization,
  saveIntegrationConnection,
  storeIntegrationAccessToken,
} from "@/lib/db/integrations";
import {
  IntegrationError,
  IntegrationReconnectError,
} from "@/lib/integrations/errors";
import {
  createAuthorizationSecrets,
  exchangeAuthorizationCode,
  fetchGmailAddress,
  googleAuthorizationUrl,
  parseAuthorizationResponse,
  refreshAccessToken,
  revokeToken,
  type GoogleOauthClient,
} from "@/lib/integrations/google/oauth";
import {
  INTEGRATIONS,
  type Integration,
  type IntegrationId,
} from "@/lib/integrations/schema";

/** Google's codes last minutes; a sign-in left open longer starts over. */
const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

/** Refresh early so a token never expires partway through a request. */
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

function requireOauthClient(integrationId: IntegrationId): GoogleOauthClient {
  const client = getIntegrationOauthClient(INTEGRATIONS[integrationId].provider);
  if (!client) {
    throw new IntegrationError(
      "An administrator has not set up Google access on this server.",
      409,
      "not_configured",
    );
  }
  return { clientId: client.clientId, clientSecret: client.clientSecret };
}

/** Begins a sign-in and returns the Google page the user approves it on. */
export function startIntegrationAuthorization(
  userId: string,
  integrationId: IntegrationId,
): { url: string } {
  const client = requireOauthClient(integrationId);
  const secrets = createAuthorizationSecrets();
  saveIntegrationAuthorization({ userId, integrationId, ...secrets });
  return {
    url: googleAuthorizationUrl({
      clientId: client.clientId,
      scopes: INTEGRATIONS[integrationId].scopes,
      ...secrets,
      // Reconnecting is routine where Google limits a sign-in to a week.
      loginHint: getIntegrationConnection(userId, integrationId)?.accountEmail,
    }),
  };
}

/**
 * Finishes a sign-in from the address the user's browser ended on, and stores
 * the grant only once it carries every permission and names its account.
 */
export async function completeIntegrationAuthorization(
  userId: string,
  integrationId: IntegrationId,
  redirectUrl: string,
): Promise<Integration> {
  const client = requireOauthClient(integrationId);
  const { code, state } = parseAuthorizationResponse(redirectUrl);

  const pending = getIntegrationAuthorization(userId, integrationId);
  if (!pending) {
    throw new IntegrationError(
      "This sign-in was already used or never started. Start again.",
      400,
    );
  }
  if (Date.now() - pending.createdAt.getTime() > AUTHORIZATION_TTL_MS) {
    deleteIntegrationAuthorization(userId, integrationId);
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
  deleteIntegrationAuthorization(userId, integrationId);

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

  const missing = INTEGRATIONS[integrationId].scopes.filter(
    (scope) => !tokens.scopes.includes(scope),
  );
  if (missing.length > 0 || !tokens.refreshToken) {
    await revokeToken(tokens.refreshToken ?? tokens.accessToken);
    throw new IntegrationError(
      missing.length > 0
        ? "Google did not grant the access OvertChat asked for. Start again and allow everything on Google's page."
        : "Google did not issue a lasting sign-in. Start again.",
      400,
    );
  }

  let accountEmail: string;
  try {
    accountEmail = await fetchGmailAddress(tokens.accessToken);
  } catch (error) {
    await revokeToken(tokens.refreshToken);
    throw error;
  }

  // Signing in replaces any earlier grant, which would otherwise stay live.
  const previous = getIntegrationConnection(userId, integrationId);
  saveIntegrationConnection({
    userId,
    integrationId,
    accountEmail,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
  });
  if (previous && previous.refreshToken !== tokens.refreshToken) {
    await revokeToken(previous.refreshToken);
  }
  return getIntegration(userId, integrationId);
}

export async function disconnectIntegration(
  userId: string,
  integrationId: IntegrationId,
): Promise<void> {
  deleteIntegrationAuthorization(userId, integrationId);
  const removed = deleteIntegrationConnection(userId, integrationId);
  if (removed) await revokeToken(removed.refreshToken);
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
  if (integrationConnectionStatus(connection) === "needs_reconnect") {
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

  const client = requireOauthClient(integrationId);
  // Concurrent tool calls share one refresh.
  const key = `${userId}\u0000${integrationId}\u0000${connection.refreshToken}`;
  const running = refreshes.get(key);
  if (running) return running;

  const refresh = (async () => {
    const guard = {
      userId,
      integrationId,
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
