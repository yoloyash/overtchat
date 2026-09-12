import "server-only";
import { enqueuePush } from "@/lib/db/pushNotifications";

export function notifyChatComplete(
  userId: string,
  chatId: string,
  streamId: string,
  parts: readonly { type: string; text?: unknown }[],
) {
  // Only visible answer text, never reasoning or tool inputs/results.
  const body = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  enqueuePush({
    userId,
    kind: "chat",
    targetId: chatId,
    eventId: streamId,
    body,
  });
}
