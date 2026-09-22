import { describe, expect, it } from "vitest";
import { agentPromptWithHistory } from "./history";
import { agentSessionCommandSchema } from "./agents";

describe("agent history actions", () => {
  it("validates rewind commands and refuses oversized attached history", () => {
    expect(
      agentSessionCommandSchema.safeParse({
        type: "rewind",
        messageId: "u1",
        mode: "both",
      }).success,
    ).toBe(true);
    expect(
      agentSessionCommandSchema.safeParse({
        type: "rewind",
        messageId: "",
        mode: "all",
      }).success,
    ).toBe(false);
    expect(() => agentPromptWithHistory("a".repeat(200_001))).toThrow("limit");
  });
});
