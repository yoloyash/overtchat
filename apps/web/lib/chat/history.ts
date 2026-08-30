import type { UIMessage } from "ai";
import type { ChatRequestAction } from "@overtchat/shared";

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

export type ReconstructedPersistedRequest = {
  messages: UIMessage[];
  persistUserMessage: boolean;
  truncateFromMessageId?: string;
};

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
  action,
}: {
  storedMessages: UIMessage[];
  requestMessages: UIMessage[];
  action: ChatRequestAction;
}): ReconstructedPersistedRequest {
  const requestUserMessage = requestMessages.at(-1);
  if (!requestUserMessage || requestUserMessage.role !== "user") {
    throw new ChatHistoryConflictError();
  }

  if (action.type === "submit") {
    if (
      storedMessages.some((message) => message.id === requestUserMessage.id)
    ) {
      throw new ChatHistoryConflictError();
    }
    return {
      messages: [...storedMessages, requestUserMessage],
      persistUserMessage: true,
    };
  }

  const targetMessageId =
    action.type === "edit"
      ? action.targetUserMessageId
      : action.type === "regenerate"
        ? action.targetAssistantMessageId
        : action.userMessageId;
  const targetIndex = storedMessages.findIndex(
    (message) => message.id === targetMessageId,
  );
  const target = storedMessages[targetIndex];

  if (action.type === "edit") {
    if (
      action.targetUserMessageId !== requestUserMessage.id ||
      !target ||
      target.role !== "user"
    ) {
      throw new ChatHistoryConflictError();
    }
    return {
      messages: [
        ...storedMessages.slice(0, targetIndex),
        requestUserMessage,
      ],
      persistUserMessage: true,
      truncateFromMessageId: target.id,
    };
  }

  if (action.type === "regenerate") {
    if (!target || target.role !== "assistant") {
      throw new ChatHistoryConflictError();
    }
    const prefix = storedMessages.slice(0, targetIndex);
    if (
      prefix.at(-1)?.role !== "user" ||
      prefix.at(-1)?.id !== requestUserMessage.id
    ) {
      throw new ChatHistoryConflictError();
    }
    return {
      messages: prefix,
      persistUserMessage: false,
      truncateFromMessageId: target.id,
    };
  }

  if (action.userMessageId !== requestUserMessage.id) {
    throw new ChatHistoryConflictError();
  }
  if (!target) {
    return {
      messages: [...storedMessages, requestUserMessage],
      persistUserMessage: true,
    };
  }
  if (target.role !== "user") {
    throw new ChatHistoryConflictError();
  }

  const following = storedMessages[targetIndex + 1];
  if (!following) {
    return {
      messages: storedMessages,
      persistUserMessage: false,
    };
  }
  if (following.role !== "assistant") {
    throw new ChatHistoryConflictError();
  }
  return {
    messages: storedMessages.slice(0, targetIndex + 1),
    persistUserMessage: false,
    truncateFromMessageId: following.id,
  };
}
