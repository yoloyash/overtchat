import type { UIMessage } from "ai";

export const CHAT_MESSAGE_PAGE_SIZE = 32;

export type ChatMessagePage = {
  messages: UIMessage[];
  nextCursor: string | null;
};

export class ChatHistoryConflictError extends Error {
  constructor() {
    super("Chat history changed; refresh and try again");
    this.name = "ChatHistoryConflictError";
  }
}

export function messagesForChatRequest(
  messages: UIMessage[],
  temporary: boolean,
): UIMessage[] {
  return temporary ? messages : messages.slice(-1);
}

/**
 * Rebuilds a saved chat from server-owned history and the request intent.
 * Clients may still send legacy full transcripts, but persisted history is
 * never trusted or uploaded as the source of truth for model context.
 */
export function reconstructPersistedMessages({
  storedMessages,
  requestMessages,
  trigger,
  messageId,
}: {
  storedMessages: UIMessage[];
  requestMessages: UIMessage[];
  trigger: "submit-message" | "regenerate-message";
  messageId?: string;
}): UIMessage[] {
  const requestUserMessage = requestMessages.at(-1);
  if (!requestUserMessage || requestUserMessage.role !== "user") {
    throw new ChatHistoryConflictError();
  }

  if (!messageId) {
    return [...storedMessages, requestUserMessage];
  }

  const targetIndex = storedMessages.findIndex(
    (message) => message.id === messageId,
  );
  const target = storedMessages[targetIndex];
  const expectedRole = trigger === "regenerate-message" ? "assistant" : "user";
  if (!target || target.role !== expectedRole) {
    throw new ChatHistoryConflictError();
  }

  const prefix = storedMessages.slice(0, targetIndex);
  if (trigger === "regenerate-message") {
    if (prefix.at(-1)?.role !== "user") {
      throw new ChatHistoryConflictError();
    }
    return prefix;
  }

  return [...prefix, requestUserMessage];
}
