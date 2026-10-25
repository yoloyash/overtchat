import type { UIMessage } from "ai";
import {
  isOpenUIToolPart,
  openUIActionOf,
  openUIFallbackText,
  type OpenUIAction,
} from "@overtchat/shared";
import { ChatRequestError } from "@/lib/chat/request";

/** Called only for a user turn that will be committed, against owned history. */
export function withSubmittedOpenUIAction(
  messages: UIMessage[],
  action?: OpenUIAction,
): UIMessage[] {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return messages;
  if (action) {
    const source = messages
      .slice(0, -1)
      .find(
        (message) =>
          message.id === action.messageId && message.role === "assistant",
      );
    const part = source?.parts.find(
      (part) => isOpenUIToolPart(part) && part.toolCallId === action.toolCallId,
    );
    if (!part || !isOpenUIToolPart(part) || part.state !== "output-available") {
      throw new ChatRequestError(
        "This interactive response is no longer available. Refresh the conversation and try again.",
        409,
      );
    }
  }
  // Never trust an action smuggled into arbitrary incoming message metadata.
  if (
    !action &&
    !(
      last.metadata &&
      typeof last.metadata === "object" &&
      "openuiAction" in last.metadata
    )
  )
    return messages;
  const metadata = {
    ...(last.metadata as Record<string, unknown> | undefined),
  };
  delete metadata.openuiAction;
  if (action) metadata.openuiAction = action;
  return [...messages.slice(0, -1), { ...last, metadata }];
}

/** Keep structured values out of the display label, but deliver them to the model. */
export function withOpenUIActionContext(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    const action = openUIActionOf(message);
    if (!action) return message;
    return {
      ...message,
      parts: [
        ...message.parts,
        {
          type: "text" as const,
          text: `\n[Submitted interactive UI action]\n${JSON.stringify(action)}\n[/Submitted interactive UI action]`,
        },
      ],
    };
  });
}

/** Successful cards whose full program is replayed so the model can revise them. */
export const OPENUI_REPLAYED_PROGRAMS = 2;

/**
 * Older programs replay as their readable text so long chats do not carry every
 * interface into context. Failed attempts before the latest message are dropped.
 */
export function withRecentOpenUIPrograms(
  messages: UIMessage[],
  keep = OPENUI_REPLAYED_PROGRAMS,
): UIMessage[] {
  let remaining = keep;
  const result = [...messages];
  for (let index = result.length - 2; index >= 0; index -= 1) {
    const message = result[index];
    if (message.role !== "assistant" || !message.parts.some(isOpenUIToolPart))
      continue;
    const parts: UIMessage["parts"] = [];
    for (const part of [...message.parts].reverse()) {
      if (!isOpenUIToolPart(part)) parts.push(part);
      else if (part.state !== "output-available") continue;
      else if (remaining > 0) {
        remaining -= 1;
        parts.push(part);
      } else {
        const text = openUIFallbackText(part);
        if (text) parts.push({ type: "text", text: `\n${text}\n` });
      }
    }
    result[index] = { ...message, parts: parts.reverse() };
  }
  return result;
}
