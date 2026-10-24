import "server-only";
import { createHash } from "node:crypto";
import {
  agentNotificationOwner,
  notificationDevices,
  removeInvalidPushDevice,
  signInRequestDevices,
} from "@/lib/db/pushNotifications";
import type { pushDevices } from "@/lib/db/schema";

type PushDevice = typeof pushDevices.$inferSelect;
type PushNotification = {
  userId: string;
  kind: "chat" | "agent";
  targetId: string;
  eventId: string;
  body: string;
};
type ExpoTicket = {
  status: "ok" | "error";
  details?: { error?: string };
};

// Submit directly in batches and handle immediate Expo tickets.
// Delivery is best-effort: there is no retry queue or receipt polling.
async function deliver(
  devices: PushDevice[],
  message: (device: PushDevice) => Record<string, unknown>,
) {
  const batches = [];
  for (let index = 0; index < devices.length; index += 100) {
    batches.push(devices.slice(index, index + 100));
  }
  await Promise.all(
    batches.map(async (batch) => {
      const messages = batch.map((device) => ({
        to: device.token,
        ...message(device),
      }));
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

function collapseId(id: string) {
  return createHash("sha256").update(id).digest("hex");
}

export async function sendPushNotification(notification: PushNotification) {
  const { userId, kind, targetId, eventId, body } = notification;
  await deliver(notificationDevices(userId, kind, targetId), (device) => {
    const id = `${kind}:${eventId}:${device.id}`;
    const preview = device.previews ? body : "";
    return {
      title: kind === "chat" ? "Your response is ready" : "Agent is idle",
      body:
        kind === "chat"
          ? preview || "Tap to view your response."
          : preview
            ? `${preview} · Tap to view the session.`
            : "Tap to view the session.",
      data: {
        kind,
        targetId,
        registrationId: device.id,
        notificationId: id,
      },
      collapseId: collapseId(id),
      tag: id,
      channelId: kind === "chat" ? "chat-responses" : "agent-idle",
      sound: "default",
      priority: "high",
      ttl: 3600,
    };
  });
}

/**
 * Asks the user's devices to approve a sign-in. The notification carries no
 * secret: the app loads the request over its own login and answers there.
 */
export async function notifySignInRequest(request: {
  userId: string;
  id: string;
  device: string;
  expiresAt: Date;
}) {
  const ttl = Math.max(
    1,
    Math.floor((request.expiresAt.getTime() - Date.now()) / 1000),
  );
  await deliver(signInRequestDevices(request.userId), (device) => {
    const id = `sign-in:${request.id}:${device.id}`;
    return {
      title: "Is this you signing in?",
      body: device.previews
        ? `${request.device} is signing in to your account. Tap to approve or deny.`
        : "Someone is signing in to your account. Tap to approve or deny.",
      data: {
        kind: "sign-in",
        targetId: request.id,
        registrationId: device.id,
        notificationId: id,
      },
      collapseId: collapseId(id),
      tag: id,
      channelId: "sign-in-requests",
      sound: "default",
      priority: "high",
      ttl,
    };
  });
}

export async function notifyAgentIdle(id: string) {
  const owner = agentNotificationOwner(id);
  if (!owner) return;
  await sendPushNotification({
    userId: owner.userId,
    kind: "agent",
    targetId: id,
    eventId: crypto.randomUUID(),
    body: owner.name?.slice(0, 120) ?? "",
  });
}
