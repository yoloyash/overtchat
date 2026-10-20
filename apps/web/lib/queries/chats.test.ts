import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_CHATS_POLL_MS,
  activeChatsRefetchInterval,
  setActiveChatInCache,
} from "./chats";
import { chatKeys } from "./keys";

describe("active chat query state", () => {
  it("polls only while at least one chat is active", () => {
    expect(activeChatsRefetchInterval(undefined)).toBe(false);
    expect(activeChatsRefetchInterval([])).toBe(false);
    expect(activeChatsRefetchInterval(["chat"])).toBe(ACTIVE_CHATS_POLL_MS);
  });

  it("optimistically adds, deduplicates, and removes chat IDs", () => {
    const queryClient = new QueryClient();

    setActiveChatInCache(queryClient, "chat-a", true);
    setActiveChatInCache(queryClient, "chat-a", true);
    setActiveChatInCache(queryClient, "chat-b", true);
    expect(queryClient.getQueryData(chatKeys.active())).toEqual([
      "chat-a",
      "chat-b",
    ]);

    setActiveChatInCache(queryClient, "chat-a", false);
    expect(queryClient.getQueryData(chatKeys.active())).toEqual(["chat-b"]);
  });
});
