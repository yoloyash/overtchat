import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { session, twoFactor, user } from "@/lib/db/schema";
import { resetActorAuthorized, type ResetAuthorization } from "@/lib/db/passwords";

/**
 * Removes a user's authenticator and backup codes and revokes every login, so
 * a lost or stolen device can't keep a session. The user can sign in with
 * their password and set two-factor up again.
 */
export function resetUserTwoFactor(
  userId: string,
  actor?: ResetAuthorization,
): "reset" | "not_found" | "not_enabled" | "unauthorized" {
  return db.transaction((tx) => {
    if (actor && !resetActorAuthorized(tx, actor)) return "unauthorized";
    const target = tx
      .select({ twoFactorEnabled: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, userId))
      .get();
    if (!target) return "not_found";
    const enrollment = tx
      .select({ id: twoFactor.id })
      .from(twoFactor)
      .where(eq(twoFactor.userId, userId))
      .get();
    if (!target.twoFactorEnabled && !enrollment) return "not_enabled";
    tx.delete(twoFactor).where(eq(twoFactor.userId, userId)).run();
    tx.update(user)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .run();
    tx.delete(session).where(eq(session.userId, userId)).run();
    return "reset";
  });
}
