import { describe, expect, it } from "vitest";

import {
  agentSessionHeldElsewhereMessage,
  isAgentSessionHeldElsewhereMessage,
} from "./session-held";

describe("session held elsewhere contract", () => {
  it("round-trips the message through the matcher", () => {
    const message = agentSessionHeldElsewhereMessage("Oh My Pi");
    expect(message).toBe(
      "This session is still open in another Oh My Pi process, such as its terminal UI. Close it there, then open it here.",
    );
    expect(isAgentSessionHeldElsewhereMessage(message)).toBe(true);
  });

  it("ignores other open failures", () => {
    expect(isAgentSessionHeldElsewhereMessage("Oh My Pi opened a different session than requested.")).toBe(false);
    expect(isAgentSessionHeldElsewhereMessage("")).toBe(false);
  });
});
