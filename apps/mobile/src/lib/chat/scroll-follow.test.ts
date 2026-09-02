import { describe, expect, it } from "vitest";
import {
  initialChatScrollFollowState,
  isChatScrollNearBottom,
  reduceChatScrollFollow,
  shouldPinChatToBottom,
} from "./scroll-follow";

describe("chat scroll following", () => {
  it("treats content within the bottom threshold as attached", () => {
    expect(
      isChatScrollNearBottom({
        contentHeight: 1_200,
        viewportHeight: 500,
        offsetY: 620,
      }),
    ).toBe(true);
    expect(
      isChatScrollNearBottom({
        contentHeight: 1_200,
        viewportHeight: 500,
        offsetY: 619,
      }),
    ).toBe(false);
  });

  it("keeps short transcripts attached", () => {
    expect(
      isChatScrollNearBottom({
        contentHeight: 320,
        viewportHeight: 500,
        offsetY: 0,
      }),
    ).toBe(true);
  });

  it("detaches as soon as an active user scroll moves away", () => {
    const dragging = reduceChatScrollFollow(initialChatScrollFollowState, {
      type: "user-scroll-begin",
    });
    const detached = reduceChatScrollFollow(dragging, {
      type: "user-scroll-position",
      nearBottom: false,
    });

    expect(detached).toEqual({ mode: "detached", userScrollActive: true });
    expect(shouldPinChatToBottom(detached)).toBe(false);
  });

  it("ignores scroll-away events that were not initiated by the user", () => {
    const next = reduceChatScrollFollow(initialChatScrollFollowState, {
      type: "user-scroll-position",
      nearBottom: false,
    });

    expect(next).toBe(initialChatScrollFollowState);
  });

  it("reattaches when a user scroll ends near the bottom", () => {
    const next = reduceChatScrollFollow(
      { mode: "detached", userScrollActive: true },
      { type: "user-scroll-end", nearBottom: true },
    );

    expect(next).toEqual(initialChatScrollFollowState);
    expect(shouldPinChatToBottom(next)).toBe(true);
  });

  it("stays detached when a user scroll ends away from the bottom", () => {
    const next = reduceChatScrollFollow(
      { mode: "detached", userScrollActive: true },
      { type: "user-scroll-end", nearBottom: false },
    );

    expect(next).toEqual({ mode: "detached", userScrollActive: false });
    expect(shouldPinChatToBottom(next)).toBe(false);
  });

  it("reattaches for an explicit follow request", () => {
    const next = reduceChatScrollFollow(
      { mode: "detached", userScrollActive: false },
      { type: "follow-requested" },
    );

    expect(next).toEqual(initialChatScrollFollowState);
  });
});
