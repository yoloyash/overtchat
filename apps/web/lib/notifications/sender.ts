import "server-only";
import { createHash } from "node:crypto";
import type { AgentProviderId } from "@overtchat/agent-bridge";
import {
  agentNotificationSession,
  notificationDevices,
  removeInvalidPushDevice,
} from "@/lib/db/pushNotifications";
import {
  agentNotificationText,
  type AgentAttentionEvent,
  type AgentNotification,
  type AgentNotificationReason,
} from "./agentNotification";
import { agentClientRegistry, planAgentNotification } from "./presence";
import { resolveInitialAgentSessionTitle } from "@/lib/agents/sessionTitle";

export type PushNotification = {
  userId: string;
  kind: "chat" | "agent";
  targetId: string;
  eventId: string;
  /** What every device gets. */
  title: string;
  body: string;
  /** What devices that allow previews get instead. */
  preview?: { title?: string; body?: string };
  channelId: string;
  data?: Record<string, string>;
};
type ExpoTicket = {
  status: "ok" | "error";
  details?: { error?: string };
};

// Submit directly in batches and handle immediate Expo tickets.
// Delivery is best-effort: there is no retry queue or receipt polling.
export async function sendPushNotification(notification: PushNotification) {
  const { userId, kind, targetId, eventId } = notification;
  const devices = notificationDevices(userId, kind, targetId);
  const batches = [];
  for (let index = 0; index < devices.length; index += 100) {
    batches.push(devices.slice(index, index + 100));
  }
  await Promise.all(
    batches.map(async (batch) => {
      const messages = batch.map((device) => {
        const id = `${kind}:${eventId}:${device.id}`;
        const preview = device.previews ? notification.preview : undefined;
        return {
          to: device.token,
          title: preview?.title || notification.title,
          body: preview?.body || notification.body,
          data: {
            kind,
            targetId,
            registrationId: device.id,
            notificationId: id,
            ...notification.data,
          },
          collapseId: createHash("sha256").update(id).digest("hex"),
          tag: id,
          channelId: notification.channelId,
          sound: "default",
          priority: "high",
          ttl: 3600,
        };
      });
      try {
        const token = process.env.EXPO_PUSH_ACCESS_TOKEN;
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          console.warn(`[push] Expo returned HTTP ${response.status}.`);
          return;
        }
        const { data } = (await response.json()) as { data?: ExpoTicket[] };
        if (!Array.isArray(data) || data.length !== batch.length) {
          console.warn("[push] Unexpected Expo ticket response.");
          return;
        }
        data.forEach((ticket, index) => {
          if (ticket.status === "ok") return;
          if (ticket.details?.error === "DeviceNotRegistered") {
            removeInvalidPushDevice(batch[index].id, batch[index].token);
          }
          // Credential errors are publisher configuration problems, not invalid
          // device registrations. Keep tokens so future sends work after a fix.
          console.warn(
            "[push] Expo rejected a notification. Check push credentials and device registration.",
          );
        });
      } catch {
        // Never log tokens, message bodies, or provider responses.
        console.warn("[push] Could not send notification to Expo.");
      }
    }),
  );
}

/** What a phone shows when the device keeps previews off. */
const PLAIN_PUSH: Record<AgentNotificationReason, { title: string; body: string }> = {
  approval: { title: "An agent needs approval", body: "Tap to review the request." },
  question: { title: "An agent has a question", body: "Tap to answer." },
  completed: { title: "An agent finished", body: "Tap to view the session." },
  failed: { title: "An agent failed", body: "Tap to view the session." },
};

/**
 * Tells the owner about a request or a finished turn: the web or desktop
 * client they used most recently if one is present, otherwise their phones.
 */
export async function notifyAgentAttention(event: AgentAttentionEvent) {
  const session = agentNotificationSession(event.sessionId);
  if (!session) return;
  const text = agentNotificationText(event, {
    title: resolveInitialAgentSessionTitle(session) ?? "New session",
    workspaceName: session.workspaceName,
    hostName: session.hostName,
  });
  const notification: AgentNotification = {
    sessionId: event.sessionId,
    reason: event.reason,
    eventId: event.eventId,
    ...text,
    provider: session.provider as AgentProviderId,
  };
  const now = Date.now();
  const plan = planAgentNotification(
    agentClientRegistry.clients(session.userId, now),
    event.sessionId,
    now,
  );
  if (
    plan.recipient &&
    agentClientRegistry.deliver(session.userId, plan.recipient, notification)
  ) {
    return;
  }
  // A client whose stream dropped since the plan leaves the phones to it.
  if (!plan.recipient && !plan.push) return;
  await sendPushNotification({
    userId: session.userId,
    kind: "agent",
    targetId: event.sessionId,
    eventId: event.eventId,
    ...PLAIN_PUSH[event.reason],
    preview: text,
    // One channel for every agent alert: phones predating this still show it.
    channelId: "agent-idle",
    data: { reason: event.reason },
  });
}
