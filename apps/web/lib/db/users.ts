import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { session, user } from "@/lib/db/schema";

export type UserRole = "user" | "admin";

export type UserRoleChangeResult =
  | {
      status: "updated" | "unchanged";
      user: {
        id: string;
        name: string;
        email: string;
        role: string | null;
      };
    }
  | { status: "not_found" }
  | { status: "self" }
  | { status: "last_admin" };

export function changeUserRole(
  actorUserId: string,
  targetUserId: string,
  role: UserRole,
): UserRoleChangeResult {
  return db.transaction((tx) => {
    const target = tx
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      })
      .from(user)
      .where(eq(user.id, targetUserId))
      .get();
    if (!target) return { status: "not_found" };
    if (target.id === actorUserId) return { status: "self" };
    if (target.role === role) return { status: "unchanged", user: target };

    if (target.role === "admin" && role === "user") {
      const administrators = tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.role, "admin"))
        .all();
      if (administrators.length <= 1) return { status: "last_admin" };
    }

    const updated = tx
      .update(user)
      .set({ role, updatedAt: new Date() })
      .where(eq(user.id, targetUserId))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      })
      .get();
    if (!updated) return { status: "not_found" };

    tx.delete(session).where(eq(session.userId, targetUserId)).run();
    return { status: "updated", user: updated };
  });
}
