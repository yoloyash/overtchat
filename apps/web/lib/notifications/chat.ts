import "server-only";
import { clipText, markdownToPlainText } from "@overtchat/shared";
import { chatReplyPreview } from "./preview";
import { sendPushNotification } from "./sender";

/** What a phone's expanded notification has room for. */
const PREVIEW_LIMIT = 240;

export function notifyChatComplete(
  userId: string,
  chatId: string,
  streamId: string,
  parts: readonly { type: string; text?: unknown }[],
  /** The scheduled task whose run this reply is. */
  taskName?: string,
) {
  const body = chatReplyPreview(parts, PREVIEW_LIMIT);
  return sendPushNotification({
    userId,
    kind: "chat",
    targetId: chatId,
    eventId: streamId,
    title: taskName ? "A scheduled task finished" : "Your response is ready",
    body: taskName ? "Tap to view the result." : "Tap to view your response.",
    preview: { ...(taskName ? { title: taskName } : {}), body },
    channelId: "chat-responses",
  });
}

/** Tells the owner's phones that a scheduled run failed, and why. */
export function notifyScheduledRunFailed(run: {
  userId: string;
  runId: string;
  /** The run's chat, when it got as far as starting one. */
  chatId: string | null;
  taskName: string;
  error: string;
}) {
  // A phone opens a chat from a chat alert. A run that never started one has
  // nothing to open, and the Scheduled page says why it failed.
  if (!run.chatId) return Promise.resolve();
  return sendPushNotification({
    userId: run.userId,
    kind: "chat",
    targetId: run.chatId,
    eventId: `scheduled-run-failed:${run.runId}`,
    title: "A scheduled task failed",
    body: "Tap to see what happened.",
    preview: {
      title: `Failed: ${run.taskName}`,
      body: clipText(markdownToPlainText(run.error), PREVIEW_LIMIT),
    },
    channelId: "chat-responses",
  });
}
