import "server-only";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentConnections,
  agentHosts,
  agentSessions,
  agentWorkspaces,
  chats,
  pushDevices,
  session,
  user,
} from "@/lib/db/schema";
import type { PushDeviceInput } from "@/lib/notifications/schema";

export function registerPushDevice(
  userId: string,
  sessionId: string,
  input: PushDeviceInput,
) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.id, input.id))
      .get();
    if (existing && existing.userId !== userId) return false;
    // A new account on the same installation replaces its previous registration.
    tx.delete(pushDevices)
      .where(
        and(eq(pushDevices.token, input.token), ne(pushDevices.id, input.id)),
      )
      .run();
    tx.insert(pushDevices)
      .values({ ...input, userId, sessionId })
      .onConflictDoUpdate({
        target: pushDevices.id,
        set: { ...input, sessionId },
      })
      .run();
    return true;
  });
}

export function unregisterPushDevice(userId: string, id: string) {
  db.delete(pushDevices)
    .where(and(eq(pushDevices.id, id), eq(pushDevices.userId, userId)))
    .run();
}

export function agentNotificationOwner(id: string) {
  return db
    .select({ userId: agentHosts.userId, name: agentSessions.name })
    .from(agentSessions)
    .innerJoin(
      agentWorkspaces,
      eq(agentWorkspaces.id, agentSessions.workspaceId),
    )
    .innerJoin(
      agentConnections,
      eq(agentConnections.id, agentWorkspaces.connectionId),
    )
    .innerJoin(agentHosts, eq(agentHosts.id, agentConnections.hostId))
    .where(eq(agentSessions.id, id))
    .get();
}

// Resolve access and device preferences immediately before submitting a push.
export function notificationDevices(
  userId: string,
  kind: "chat" | "agent",
  targetId: string,
) {
  const owner =
    kind === "chat"
      ? db
          .select({ userId: chats.userId })
          .from(chats)
          .where(eq(chats.id, targetId))
          .get()
      : agentNotificationOwner(targetId);
  if (owner?.userId !== userId) return [];
  return db
    .select({ device: pushDevices, banned: user.banned, role: user.role })
    .from(pushDevices)
    .innerJoin(
      session,
      and(
        eq(session.id, pushDevices.sessionId),
        eq(session.userId, pushDevices.userId),
      ),
    )
    .innerJoin(user, eq(user.id, pushDevices.userId))
    .where(
      and(
        eq(pushDevices.userId, userId),
        gt(session.expiresAt, new Date()),
        eq(kind === "chat" ? pushDevices.chats : pushDevices.agents, true),
      ),
    )
    .all()
    .filter((row) => !row.banned && (kind !== "agent" || row.role === "admin"))
    .map((row) => row.device);
}

export function removeInvalidPushDevice(id: string, token: string) {
  // A registration may have refreshed while the send was in flight.
  db.delete(pushDevices)
    .where(and(eq(pushDevices.id, id), eq(pushDevices.token, token)))
    .run();
}
