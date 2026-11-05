import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  integrationAuthorizations,
  integrationConnections,
  integrationOauthClients,
} from "@/lib/db/schema";
import {
  INTEGRATION_IDS,
  INTEGRATIONS,
  type Integration,
  type IntegrationId,
  type IntegrationOauthClient,
  type IntegrationProvider,
} from "@/lib/integrations/schema";

export type IntegrationOauthClientRow =
  typeof integrationOauthClients.$inferSelect;
export type IntegrationConnectionRow =
  typeof integrationConnections.$inferSelect;
export type IntegrationAuthorizationRow =
  typeof integrationAuthorizations.$inferSelect;

function providerIntegrations(provider: IntegrationProvider): IntegrationId[] {
  return INTEGRATION_IDS.filter((id) => INTEGRATIONS[id].provider === provider);
}

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
    const integrations = providerIntegrations(provider);
    if (previous && previous.clientId !== input.clientId) {
      tx.update(integrationConnections)
        .set({
          status: "needs_reconnect",
          accessToken: null,
          accessTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(inArray(integrationConnections.integrationId, integrations))
        .run();
      tx.delete(integrationAuthorizations)
        .where(inArray(integrationAuthorizations.integrationId, integrations))
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
  const integrations = providerIntegrations(provider);
  db.transaction((tx) => {
    tx.delete(integrationConnections)
      .where(inArray(integrationConnections.integrationId, integrations))
      .run();
    tx.delete(integrationAuthorizations)
      .where(inArray(integrationAuthorizations.integrationId, integrations))
      .run();
    tx.delete(integrationOauthClients)
      .where(eq(integrationOauthClients.provider, provider))
      .run();
  });
}

export function getIntegrationConnection(
  userId: string,
  integrationId: IntegrationId,
): IntegrationConnectionRow | null {
  return (
    db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.userId, userId),
          eq(integrationConnections.integrationId, integrationId),
        ),
      )
      .get() ?? null
  );
}

function toIntegration(
  id: IntegrationId,
  configured: boolean,
  connection: IntegrationConnectionRow | null,
): Integration {
  return {
    id,
    configured,
    connection: connection
      ? {
          accountEmail: connection.accountEmail,
          status: connection.status,
          connectedAt: connection.createdAt.toISOString(),
        }
      : null,
  };
}

export function getIntegration(
  userId: string,
  integrationId: IntegrationId,
): Integration {
  return toIntegration(
    integrationId,
    getIntegrationOauthClient(INTEGRATIONS[integrationId].provider) !== null,
    getIntegrationConnection(userId, integrationId),
  );
}

export function listIntegrations(userId: string): Integration[] {
  return INTEGRATION_IDS.map((id) => getIntegration(userId, id));
}

export function saveIntegrationConnection(input: {
  userId: string;
  integrationId: IntegrationId;
  accountEmail: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
}): void {
  const now = new Date();
  const grant = {
    accountEmail: input.accountEmail,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    status: "connected" as const,
    // A reconnect is a new grant, so its connection date starts over.
    createdAt: now,
    updatedAt: now,
  };
  db.insert(integrationConnections)
    .values({
      userId: input.userId,
      integrationId: input.integrationId,
      ...grant,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnections.userId,
        integrationConnections.integrationId,
      ],
      set: grant,
    })
    .run();
}

/**
 * Stores a refreshed access token. `refreshToken` guards against a refresh
 * that finished after the user reconnected or disconnected.
 */
export function storeIntegrationAccessToken(input: {
  userId: string;
  integrationId: IntegrationId;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
}): void {
  db.update(integrationConnections)
    .set({
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationConnections.userId, input.userId),
        eq(integrationConnections.integrationId, input.integrationId),
        eq(integrationConnections.refreshToken, input.refreshToken),
      ),
    )
    .run();
}

/** Same guard as `storeIntegrationAccessToken`. */
export function markIntegrationNeedsReconnect(input: {
  userId: string;
  integrationId: IntegrationId;
  refreshToken: string;
}): void {
  db.update(integrationConnections)
    .set({
      status: "needs_reconnect",
      accessToken: null,
      accessTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationConnections.userId, input.userId),
        eq(integrationConnections.integrationId, input.integrationId),
        eq(integrationConnections.refreshToken, input.refreshToken),
      ),
    )
    .run();
}

/** Returns the removed connection so the caller can revoke its grant. */
export function deleteIntegrationConnection(
  userId: string,
  integrationId: IntegrationId,
): IntegrationConnectionRow | null {
  const [row] = db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.userId, userId),
        eq(integrationConnections.integrationId, integrationId),
      ),
    )
    .returning()
    .all();
  return row ?? null;
}

export function saveIntegrationAuthorization(input: {
  userId: string;
  integrationId: IntegrationId;
  state: string;
  codeVerifier: string;
}): void {
  const createdAt = new Date();
  db.insert(integrationAuthorizations)
    .values({ ...input, createdAt })
    .onConflictDoUpdate({
      target: [
        integrationAuthorizations.userId,
        integrationAuthorizations.integrationId,
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
  integrationId: IntegrationId,
): IntegrationAuthorizationRow | null {
  return (
    db
      .select()
      .from(integrationAuthorizations)
      .where(
        and(
          eq(integrationAuthorizations.userId, userId),
          eq(integrationAuthorizations.integrationId, integrationId),
        ),
      )
      .get() ?? null
  );
}

export function deleteIntegrationAuthorization(
  userId: string,
  integrationId: IntegrationId,
): void {
  db.delete(integrationAuthorizations)
    .where(
      and(
        eq(integrationAuthorizations.userId, userId),
        eq(integrationAuthorizations.integrationId, integrationId),
      ),
    )
    .run();
}
