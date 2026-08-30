import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  ChatHistoryConflictError,
  messagesForChatRequest,
  reconstructPersistedMessages,
} from "./history";

function message(id: string, role: UIMessage["role"]): UIMessage {
  return { id, role, parts: [{ type: "text", text: id }] };
}

const stored = [
  message("user-1", "user"),
  message("assistant-1", "assistant"),
  message("user-2", "user"),
  message("assistant-2", "assistant"),
];

describe("messagesForChatRequest", () => {
  it("sends only the current intent for a persisted chat", () => {
    expect(messagesForChatRequest(stored, false)).toEqual([stored.at(-1)]);
  });

  it("keeps client-owned temporary chat context intact", () => {
    expect(messagesForChatRequest(stored, true)).toBe(stored);
  });
});

describe("reconstructPersistedMessages", () => {
  it("appends only the requested user turn to canonical stored history", () => {
    const next = message("user-3", "user");

    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        // A legacy client may upload stale or fabricated history. Only its
        // final user intent is accepted for a saved chat.
        requestMessages: [message("fabricated", "assistant"), next],
        action: { type: "submit" },
      }).messages.map(({ id }) => id),
    ).toEqual(["user-1", "assistant-1", "user-2", "assistant-2", "user-3"]);
  });

  it("replaces an edited user turn and drops its old branch", () => {
    const replacement = message("user-2", "user");

    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [replacement],
        action: { type: "edit", targetUserMessageId: "user-2" },
      }).messages.map(({ id }) => id),
    ).toEqual(["user-1", "assistant-1", "user-2"]);
  });

  it("reconstructs regeneration context through the preceding user turn", () => {
    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-2", "user")],
        action: {
          type: "regenerate",
          targetAssistantMessageId: "assistant-2",
        },
      }).messages.map(({ id }) => id),
    ).toEqual(["user-1", "assistant-1", "user-2"]);
  });

  it("retries a user turn that already has a saved assistant", () => {
    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-2", "user")],
        action: { type: "retry", userMessageId: "user-2" },
      }),
    ).toEqual({
      messages: stored.slice(0, 3),
      persistUserMessage: false,
      truncateFromMessageId: "assistant-2",
    });
  });

  it("retries an older user turn and drops its saved branch", () => {
    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-1", "user")],
        action: { type: "retry", userMessageId: "user-1" },
      }),
    ).toEqual({
      messages: [stored[0]],
      persistUserMessage: false,
      truncateFromMessageId: "assistant-1",
    });
  });

  it("retries a user turn that was committed before generation failed", () => {
    const interrupted = stored.slice(0, 3);

    expect(
      reconstructPersistedMessages({
        storedMessages: interrupted,
        requestMessages: [message("user-2", "user")],
        action: { type: "retry", userMessageId: "user-2" },
      }),
    ).toEqual({
      messages: interrupted,
      persistUserMessage: false,
    });
  });

  it("retries a user turn that failed before it was committed", () => {
    const pending = message("user-3", "user");

    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [pending],
        action: { type: "retry", userMessageId: "user-3" },
      }),
    ).toEqual({
      messages: [...stored, pending],
      persistUserMessage: true,
    });
  });

  it("rejects stale targets instead of regenerating the wrong branch", () => {
    expect(() =>
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-2", "user")],
        action: {
          type: "regenerate",
          targetAssistantMessageId: "missing",
        },
      }),
    ).toThrow(ChatHistoryConflictError);
  });

  it("rejects a regenerate action whose request user is from another turn", () => {
    expect(() =>
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-1", "user")],
        action: {
          type: "regenerate",
          targetAssistantMessageId: "assistant-2",
        },
      }),
    ).toThrow(ChatHistoryConflictError);
  });

  it("rejects a submit that reuses a persisted message id", () => {
    expect(() =>
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-2", "user")],
        action: { type: "submit" },
      }),
    ).toThrow(ChatHistoryConflictError);
  });

  it("rejects retry actions that do not identify the request user", () => {
    expect(() =>
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-2", "user")],
        action: { type: "retry", userMessageId: "user-1" },
      }),
    ).toThrow(ChatHistoryConflictError);
  });
});
