import { describe, expect, it } from "vitest";
import {
  isToolDenied,
  isToolSettled,
  toolDenialReason,
} from "@overtchat/shared";

describe("AI SDK tool denial state", () => {
  it("recognizes the terminal output-denied state and reason", () => {
    const part = {
      state: "output-denied",
      approval: {
        id: "approval-1",
        approved: false,
        reason: " Web search is disabled by the user. ",
      },
    };

    expect(isToolDenied(part)).toBe(true);
    expect(isToolSettled(part)).toBe(true);
    expect(toolDenialReason(part)).toBe(
      "Web search is disabled by the user.",
    );
  });

  it("recognizes the negative approval response before output-denied arrives", () => {
    const part = {
      state: "approval-responded",
      approval: { id: "approval-1", approved: false },
    };

    expect(isToolDenied(part)).toBe(true);
    expect(isToolSettled(part)).toBe(true);
    expect(toolDenialReason(part)).toBeUndefined();
  });

  it("does not treat a pending or approved tool as denied", () => {
    expect(
      isToolDenied({
        state: "approval-requested",
        approval: { id: "approval-1" },
      }),
    ).toBe(false);
    expect(
      isToolSettled({
        state: "approval-responded",
        approval: { id: "approval-1", approved: true },
      }),
    ).toBe(false);
  });
});
