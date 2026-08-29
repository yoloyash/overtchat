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
        trigger: "submit-message",
      }).map(({ id }) => id),
    ).toEqual(["user-1", "assistant-1", "user-2", "assistant-2", "user-3"]);
  });

  it("replaces an edited user turn and drops its old branch", () => {
    const replacement = message("user-2", "user");

    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [replacement],
        trigger: "submit-message",
        messageId: "user-2",
      }).map(({ id }) => id),
    ).toEqual(["user-1", "assistant-1", "user-2"]);
  });

  it("reconstructs regeneration context through the preceding user turn", () => {
    expect(
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-2", "user")],
        trigger: "regenerate-message",
        messageId: "assistant-2",
      }).map(({ id }) => id),
    ).toEqual(["user-1", "assistant-1", "user-2"]);
  });

  it("rejects stale targets instead of regenerating the wrong branch", () => {
    expect(() =>
      reconstructPersistedMessages({
        storedMessages: stored,
        requestMessages: [message("user-2", "user")],
        trigger: "regenerate-message",
        messageId: "missing",
      }),
    ).toThrow(ChatHistoryConflictError);
  });
});
