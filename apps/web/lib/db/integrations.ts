import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  integrationAccounts,
  integrationAuthorizations,
  integrationOauthClients,
} from "@/lib/db/schema";
import {
  grantedIntegrations,
  INTEGRATION_IDS,
  INTEGRATIONS,
  type Integration,
  type IntegrationId,
  type IntegrationOauthClient,
  type IntegrationProvider,
} from "@/lib/integrations/schema";

export type IntegrationOauthClientRow =
  typeof integrationOauthClients.$inferSelect;
export type IntegrationAccountRow = typeof integrationAccounts.$inferSelect;
export type IntegrationAuthorizationRow =
  typeof integrationAuthorizations.$inferSelect;

export function toIntegrationOauthClient(
  provider: IntegrationProvider,
  row: IntegrationOauthClientRow | null,
): IntegrationOauthClient {
  return {
    provider,
    clientId: row?.clientId ?? null,
    clientSecretSet: Boolean(row?.clientSecret),
  };
}

export function getIntegrationOauthClient(
  provider: IntegrationProvider,
): IntegrationOauthClientRow | null {
  return (
    db
      .select()
      .from(integrationOauthClients)
      .where(eq(integrationOauthClients.provider, provider))
      .get() ?? null
  );
}

/**
 * Stores the provider's client. Grants belong to the client that issued them,
 * so a different client ID leaves every existing connection unusable until its
 * owner signs in again.
 */
export function saveIntegrationOauthClient(
  provider: IntegrationProvider,
  input: { clientId: string; clientSecret: string },
): IntegrationOauthClientRow {
  return db.transaction((tx) => {
    const previous = tx
      .select({ clientId: integrationOauthClients.clientId })
      .from(integrationOauthClients)
      .where(eq(integrationOauthClients.provider, provider))
      .get();
    tx.insert(integrationOauthClients)
      .values({ provider, ...input })
      .onConflictDoUpdate({
        target: integrationOauthClients.provider,
        set: { ...input, updatedAt: new Date() },
      })
      .run();
    if (previous && previous.clientId !== input.clientId) {
      tx.update(integrationAccounts)
        .set({
          status: "needs_reconnect",
          accessToken: null,
          accessTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(integrationAccounts.provider, provider))
        .run();
      tx.delete(integrationAuthorizations)
        .where(eq(integrationAuthorizations.provider, provider))
        .run();
    }
    return tx
      .select()
      .from(integrationOauthClients)
      .where(eq(integrationOauthClients.provider, provider))
      .get()!;
  });
}

/** Removes the client along with every grant that depended on it. */
export function deleteIntegrationOauthClient(
  provider: IntegrationProvider,
): void {
  db.transaction((tx) => {
    tx.delete(integrationAccounts)
      .where(eq(integrationAccounts.provider, provider))
      .run();
    tx.delete(integrationAuthorizations)
      .where(eq(integrationAuthorizations.provider, provider))
      .run();
    tx.delete(integrationOauthClients)
      .where(eq(integrationOauthClients.provider, provider))
      .run();
  });
}

/** The user's sign-in to a provider, whatever it covers. */
export function getIntegrationAccount(
  userId: string,
  provider: IntegrationProvider,
): IntegrationAccountRow | null {
  return (
    db
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.provider, provider),
        ),
      )
      .get() ?? null
  );
}

/** The user's sign-in, when it covers this integration. */
export function getIntegrationConnection(
  userId: string,
  integrationId: IntegrationId,
): IntegrationAccountRow | null {
  const { provider } = INTEGRATIONS[integrationId];
  const account = getIntegrationAccount(userId, provider);
  return account &&
    grantedIntegrations(provider, account.scopes).includes(integrationId)
    ? account
    : null;
}

function toIntegration(
  id: IntegrationId,
  configured: boolean,
  account: IntegrationAccountRow | null,
): Integration {
  const { provider } = INTEGRATIONS[id];
  const covered =
    account !== null &&
    grantedIntegrations(provider, account.scopes).includes(id);
  return {
    id,
    provider,
    configured,
    connection: covered
      ? {
          accountEmail: account.accountEmail,
          status: account.status,
          connectedAt: account.createdAt.toISOString(),
          alwaysOn: account.alwaysOn.includes(id),
        }
      : null,
  };
}

export function getIntegration(
  userId: string,
  integrationId: IntegrationId,
): Integration {
  const { provider } = INTEGRATIONS[integrationId];
  return toIntegration(
    integrationId,
    getIntegrationOauthClient(provider) !== null,
    getIntegrationAccount(userId, provider),
  );
}

export function listIntegrations(userId: string): Integration[] {
  return INTEGRATION_IDS.map((id) => getIntegration(userId, id));
}

export function saveIntegrationAccount(input: {
  userId: string;
  provider: IntegrationProvider;
  accountEmail: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  scopes: string[];
}): void {
  const now = new Date();
  const grant = {
    accountEmail: input.accountEmail,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    scopes: input.scopes,
    status: "connected" as const,
    // A reconnect is a new grant, so its connection date starts over.
    createdAt: now,
    updatedAt: now,
  };
  db.insert(integrationAccounts)
    .values({ userId: input.userId, provider: input.provider, ...grant })
    .onConflictDoUpdate({
      target: [integrationAccounts.userId, integrationAccounts.provider],
      set: grant,
    })
    .run();
}

/** Returns false when the user's sign-in does not cover the integration. */
export function setIntegrationAlwaysOn(
  userId: string,
  integrationId: IntegrationId,
  alwaysOn: boolean,
): boolean {
  const account = getIntegrationConnection(userId, integrationId);
  if (!account) return false;
  const others = account.alwaysOn.filter((id) => id !== integrationId);
  db.update(integrationAccounts)
    .set({
      alwaysOn: alwaysOn ? [...others, integrationId] : others,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.provider, account.provider),
      ),
    )
    .run();
  return true;
}

/**
 * Stores a refreshed access token. `refreshToken` guards against a refresh
 * that finished after the user reconnected or disconnected.
 */
export function storeIntegrationAccessToken(input: {
  userId: string;
  provider: IntegrationProvider;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
}): void {
  db.update(integrationAccounts)
    .set({
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationAccounts.userId, input.userId),
        eq(integrationAccounts.provider, input.provider),
        eq(integrationAccounts.refreshToken, input.refreshToken),
      ),
    )
    .run();
}

/** Same guard as `storeIntegrationAccessToken`. */
export function markIntegrationNeedsReconnect(input: {
  userId: string;
  provider: IntegrationProvider;
  refreshToken: string;
}): void {
  db.update(integrationAccounts)
    .set({
      status: "needs_reconnect",
      accessToken: null,
      accessTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationAccounts.userId, input.userId),
        eq(integrationAccounts.provider, input.provider),
        eq(integrationAccounts.refreshToken, input.refreshToken),
      ),
    )
    .run();
}

/** Returns the removed sign-in so the caller can revoke its grant. */
export function deleteIntegrationAccount(
  userId: string,
  provider: IntegrationProvider,
): IntegrationAccountRow | null {
  const [row] = db
    .delete(integrationAccounts)
    .where(
      and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.provider, provider),
      ),
    )
    .returning()
    .all();
  return row ?? null;
}

export function saveIntegrationAuthorization(input: {
  userId: string;
  provider: IntegrationProvider;
  state: string;
  codeVerifier: string;
}): void {
  const createdAt = new Date();
  db.insert(integrationAuthorizations)
    .values({ ...input, createdAt })
    .onConflictDoUpdate({
      target: [
        integrationAuthorizations.userId,
        integrationAuthorizations.provider,
      ],
      set: {
        state: input.state,
        codeVerifier: input.codeVerifier,
        createdAt,
      },
    })
    .run();
}

export function getIntegrationAuthorization(
  userId: string,
  provider: IntegrationProvider,
): IntegrationAuthorizationRow | null {
  return (
    db
      .select()
      .from(integrationAuthorizations)
      .where(
        and(
          eq(integrationAuthorizations.userId, userId),
          eq(integrationAuthorizations.provider, provider),
        ),
      )
      .get() ?? null
  );
}

export function deleteIntegrationAuthorization(
  userId: string,
  provider: IntegrationProvider,
): void {
  db.delete(integrationAuthorizations)
    .where(
      and(
        eq(integrationAuthorizations.userId, userId),
        eq(integrationAuthorizations.provider, provider),
      ),
    )
    .run();
}
