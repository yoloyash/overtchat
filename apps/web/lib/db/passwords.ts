import "server-only";
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

type ResetAuthorization = {
  userId: string;
  sessionId: string;
  passwordHash: string;
};

/** Commit the replacement credential and revoke every login together. */
export function resetUserPassword(
  userId: string,
  passwordHash: string,
  actor?: ResetAuthorization,
): "updated" | "not_found" | "no_password" | "unauthorized" {
  return db.transaction((tx) => {
    // Recheck authorization after asynchronous password verification/hashing.
    if (actor) {
      const actingUser = tx
        .select()
        .from(user)
        .where(eq(user.id, actor.userId))
        .get();
      const actingSession = tx
        .select()
        .from(session)
        .where(
          and(
            eq(session.id, actor.sessionId),
            eq(session.userId, actor.userId),
          ),
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
      if (
        actingUser?.role !== "admin" ||
        actingUser.banned ||
        !actingSession ||
        actingSession.expiresAt <= new Date() ||
        credential?.password !== actor.passwordHash
      )
        return "unauthorized";
    }
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
    if (!credential) return "no_password";
    tx.update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(account.id, credential.id))
      .run();
    tx.delete(session).where(eq(session.userId, userId)).run();
    return "updated";
  });
}
