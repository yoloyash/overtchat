import {
  clipText,
  markdownToPlainText,
  stripCitationMarkers,
} from "@overtchat/shared";

/**
 * The reply's visible text as plain text, clipped to `limit`: never reasoning,
 * tool input or tool output, and no Markdown markers or citation anchors,
 * which a notification would show as typed.
 */
export function chatReplyPreview(
  parts: readonly { type: string; text?: unknown }[],
  limit: number,
): string {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => markdownToPlainText(stripCitationMarkers(part.text as string)))
    .join(" ");
  return clipText(text, limit);
}
