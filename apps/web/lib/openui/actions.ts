import type { UIMessage } from "ai";
import {
  isOpenUIToolPart,
  openUIActionOf,
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
