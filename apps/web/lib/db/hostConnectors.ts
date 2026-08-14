import "server-only";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  hostConnectorPairings,
  hostConnectors,
  user,
} from "@/lib/db/schema";

const PAIRING_TTL_MS = 10 * 60_000;

export type HostConnectorRow = typeof hostConnectors.$inferSelect;

function installationOwnerUserId(): string | null {
  return (
    db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "admin"))
      .orderBy(asc(user.createdAt))
      .limit(1)
      .get()?.id ?? null
  );
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function secretsMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function credential(prefix: string): {
  id: string;
  secret: string;
  value: string;
  secretHash: string;
} {
  const id = randomBytes(12).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  return {
    id,
    secret,
    value: `${prefix}_${id}.${secret}`,
    secretHash: hashSecret(secret),
  };
}

function parseCredential(
  value: string,
  prefix: string,
): { id: string; secret: string } | null {
  const match = new RegExp(`^${prefix}_([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)$`, "u")
    .exec(value);
  return match?.[1] && match[2]
    ? { id: match[1], secret: match[2] }
    : null;
}

export function createHostConnectorPairing(userId: string): {
  pairCode: string;
  expiresAt: Date;
} {
  const pair = credential("ocp");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  db.transaction((tx) => {
    tx.delete(hostConnectorPairings)
      .where(eq(hostConnectorPairings.userId, userId))
      .run();
    tx.insert(hostConnectorPairings)
      .values({
        id: pair.id,
        userId,
        secretHash: pair.secretHash,
        expiresAt,
      })
      .run();
  });
  return { pairCode: pair.value, expiresAt };
}

export function provisionManagedHostConnector(input: {
  name: string;
  version: string | null;
}): { connector: HostConnectorRow; token: string } {
  const token = credential("oct");
  const installationOwner = installationOwnerUserId();
  return db.transaction((tx) => {
    const managed = tx
      .select()
      .from(hostConnectors)
      .where(eq(hostConnectors.managed, true))
      .limit(1)
      .get();
    const ownerConnector = installationOwner
      ? tx
          .select()
          .from(hostConnectors)
          .where(eq(hostConnectors.userId, installationOwner))
          .limit(1)
          .get()
      : null;
    const existing = managed ?? ownerConnector;
    const ownerUserId = existing?.userId ?? installationOwner;
    const connector = existing
      ? tx
          .update(hostConnectors)
          .set({
            userId: ownerUserId,
            managed: true,
            name: input.name,
            tokenHash: token.secretHash,
            version: input.version,
            updatedAt: new Date(),
          })
          .where(eq(hostConnectors.id, existing.id))
          .returning()
          .get()
      : tx
          .insert(hostConnectors)
          .values({
            id: token.id,
            userId: ownerUserId,
            managed: true,
            name: input.name,
            tokenHash: token.secretHash,
            version: input.version,
          })
          .returning()
          .get();
    if (!connector) throw new Error("Failed to provision the Host Connector.");
    return {
      connector,
      token: existing
        ? `oct_${existing.id}.${token.secret}`
        : token.value,
    };
  });
}

export function claimManagedHostConnector(userId: string): void {
  db.update(hostConnectors)
    .set({ userId, updatedAt: new Date() })
    .where(and(eq(hostConnectors.managed, true), isNull(hostConnectors.userId)))
    .run();
}

export function getManagedHostConnector(): HostConnectorRow | null {
  return (
    db
      .select()
      .from(hostConnectors)
      .where(eq(hostConnectors.managed, true))
      .limit(1)
      .get() ?? null
  );
}

export function consumeHostConnectorPairing(input: {
  pairCode: string;
  name: string;
  version: string | null;
}): { connector: HostConnectorRow; token: string } | null {
  const parsed = parseCredential(input.pairCode, "ocp");
  if (!parsed) return null;
  const pair = db
    .select()
    .from(hostConnectorPairings)
    .where(eq(hostConnectorPairings.id, parsed.id))
    .get();
  if (
    !pair ||
    pair.expiresAt.getTime() <= Date.now() ||
    !secretsMatch(pair.secretHash, hashSecret(parsed.secret))
  ) {
    return null;
  }

  const token = credential("oct");
  return db.transaction((tx) => {
    const consumed = tx
      .delete(hostConnectorPairings)
      .where(
        and(
          eq(hostConnectorPairings.id, pair.id),
          eq(hostConnectorPairings.secretHash, pair.secretHash),
          gt(hostConnectorPairings.expiresAt, new Date()),
        ),
      )
      .returning()
      .get();
    if (!consumed) return null;

    const existing = tx
      .select()
      .from(hostConnectors)
      .where(eq(hostConnectors.userId, consumed.userId))
      .get();
    let connector: HostConnectorRow | undefined;
    if (existing) {
      connector = tx
        .update(hostConnectors)
        .set({
          name: input.name,
          tokenHash: token.secretHash,
          version: input.version,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(hostConnectors.id, existing.id))
        .returning()
        .get();
    } else {
      connector = tx
        .insert(hostConnectors)
        .values({
          id: token.id,
          userId: consumed.userId,
          name: input.name,
          tokenHash: token.secretHash,
          version: input.version,
          lastSeenAt: new Date(),
        })
        .returning()
        .get();
    }
    if (!connector) throw new Error("Failed to pair the Host Connector.");
    const tokenValue = existing
      ? `oct_${existing.id}.${token.secret}`
      : token.value;
    return { connector, token: tokenValue };
  });
}

export function authenticateHostConnectorToken(
  token: string,
): HostConnectorRow | null {
  const parsed = parseCredential(token, "oct");
  if (!parsed) return null;
  const connector = db
    .select()
    .from(hostConnectors)
    .where(eq(hostConnectors.id, parsed.id))
    .get();
  if (
    !connector ||
    !secretsMatch(connector.tokenHash, hashSecret(parsed.secret))
  ) {
    return null;
  }
  return connector;
}

export function listHostConnectors(userId: string): HostConnectorRow[] {
  return db
    .select()
    .from(hostConnectors)
    .where(eq(hostConnectors.userId, userId))
    .all();
}

export function getOwnedHostConnector(
  id: string,
  userId: string,
): HostConnectorRow | null {
  return (
    db
      .select()
      .from(hostConnectors)
      .where(
        and(eq(hostConnectors.id, id), eq(hostConnectors.userId, userId)),
      )
      .get() ?? null
  );
}

export function touchHostConnector(
  id: string,
  version?: string | null,
): void {
  db.update(hostConnectors)
    .set({
      lastSeenAt: new Date(),
      ...(version !== undefined ? { version } : {}),
      updatedAt: new Date(),
    })
    .where(eq(hostConnectors.id, id))
    .run();
}

export function deleteHostConnector(id: string, userId: string): boolean {
  return (
    db
      .delete(hostConnectors)
      .where(and(eq(hostConnectors.id, id), eq(hostConnectors.userId, userId)))
      .returning({ id: hostConnectors.id })
      .all().length > 0
  );
}

export function deleteExpiredHostConnectorPairings(): void {
  db.delete(hostConnectorPairings)
    .where(lt(hostConnectorPairings.expiresAt, new Date()))
    .run();
}
