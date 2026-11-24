import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account, session, user } from "@/lib/db/schema";

export function findPasswordAccount(userId: string) {
  return db
    .select()
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    )
    .get();
}

export function findUserByEmail(email: string) {
  return db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .get();
}

export type ResetAuthorization = {
  userId: string;
  sessionId: string;
  passwordHash: string;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rechecks an administrator's reset authorization inside the transaction, after
 * asynchronous password verification and hashing.
 */
export function resetActorAuthorized(
  tx: Transaction,
  actor: ResetAuthorization,
): boolean {
  const actingUser = tx
    .select()
    .from(user)
    .where(eq(user.id, actor.userId))
    .get();
  const actingSession = tx
    .select()
    .from(session)
    .where(
      and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId)),
    )
    .get();
  const credential = tx
    .select()
    .from(account)
    .where(
      and(
        eq(account.userId, actor.userId),
        eq(account.providerId, "credential"),
      ),
    )
    .get();
  return (
    actingUser?.role === "admin" &&
    !actingUser.banned &&
    !!actingSession &&
    actingSession.expiresAt > new Date() &&
    credential?.password === actor.passwordHash
  );
}

/**
 * Commit the replacement credential and revoke every login together. An
 * account that only signed in through the identity provider gets its first
 * password this way.
 */
export function resetUserPassword(
  userId: string,
  passwordHash: string,
  actor?: ResetAuthorization,
): "updated" | "not_found" | "unauthorized" {
  return db.transaction((tx) => {
    if (actor && !resetActorAuthorized(tx, actor)) return "unauthorized";
    if (
      !tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).get()
    ) {
      return "not_found";
    }
    const credential = tx
      .select({ id: account.id })
      .from(account)
      .where(
        and(eq(account.userId, userId), eq(account.providerId, "credential")),
      )
      .get();
    const now = new Date();
    if (credential) {
      tx.update(account)
        .set({ password: passwordHash, updatedAt: now })
        .where(eq(account.id, credential.id))
        .run();
    } else {
      tx.insert(account)
        .values({
          id: randomUUID(),
          userId,
          accountId: userId,
          providerId: "credential",
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    tx.delete(session).where(eq(session.userId, userId)).run();
    return "updated";
  });
}
