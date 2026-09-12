import "server-only";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentConnections,
  agentHosts,
  agentSessions,
  agentWorkspaces,
  chats,
  pushDevices,
  pushJobs,
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

export function enqueuePush({
  userId,
  kind,
  targetId,
  eventId,
  body,
}: {
  userId: string;
  kind: "chat" | "agent";
  targetId: string;
  eventId: string;
  body: string;
}) {
  const now = Date.now();
  const devices = db
    .select({ device: pushDevices })
    .from(pushDevices)
    .innerJoin(session, eq(session.id, pushDevices.sessionId))
    .where(
      and(
        eq(pushDevices.userId, userId),
        gt(session.expiresAt, new Date(now)),
        eq(kind === "chat" ? pushDevices.chats : pushDevices.agents, true),
      ),
    )
    .all();
  for (const { device } of devices) {
    db.insert(pushJobs)
      .values({
        id: `${kind}:${eventId}:${device.id}`,
        deviceId: device.id,
        kind,
        targetId,
        body: device.previews ? body : "",
        nextAttemptAt: now,
        expiresAt: now + 3_600_000,
      })
      .onConflictDoNothing()
      .run();
  }
}

export function enqueueAgentIdle(id: string) {
  const owner = agentNotificationOwner(id);
  if (!owner) return;
  enqueuePush({
    userId: owner.userId,
    kind: "agent",
    targetId: id,
    eventId: crypto.randomUUID(),
    body: owner.name?.slice(0, 120) ?? "",
  });
}

export function cancelAgentPush(id: string) {
  db.delete(pushJobs)
    .where(
      and(
        eq(pushJobs.kind, "agent"),
        eq(pushJobs.targetId, id),
        isNull(pushJobs.receiptId),
      ),
    )
    .run();
}

export function deliveryDevice(job: typeof pushJobs.$inferSelect) {
  const now = Date.now();
  const row = db
    .select({ device: pushDevices, banned: user.banned, role: user.role })
    .from(pushDevices)
    .innerJoin(session, eq(session.id, pushDevices.sessionId))
    .innerJoin(user, eq(user.id, pushDevices.userId))
    .where(
      and(
        eq(pushDevices.id, job.deviceId),
        gt(session.expiresAt, new Date(now)),
      ),
    )
    .get();
  if (!row || row.banned) return null;
  const { device } = row;
  if (!(job.kind === "chat" ? device.chats : device.agents)) return null;
  const owner =
    job.kind === "chat"
      ? db
          .select({ userId: chats.userId })
          .from(chats)
          .where(eq(chats.id, job.targetId))
          .get()
      : agentNotificationOwner(job.targetId);
  if (
    owner?.userId !== device.userId ||
    (job.kind === "agent" && row.role !== "admin")
  )
    return null;
  return device;
}
