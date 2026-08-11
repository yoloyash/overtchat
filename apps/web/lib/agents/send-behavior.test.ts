import { describe, expect, it } from "vitest";
import { resolveAgentSendDelivery } from "./send-behavior";

describe("resolveAgentSendDelivery", () => {
  it("uses a normal prompt while the agent is idle", () => {
    expect(
      resolveAgentSendDelivery({
        running: false,
        supportsSteer: true,
        behavior: "queue",
      }),
    ).toBe("prompt");
  });

  it("uses the preferred active-run delivery and its keyboard alternate", () => {
    expect(
      resolveAgentSendDelivery({
        running: true,
        supportsSteer: true,
        behavior: "steer",
      }),
    ).toBe("steer");
    expect(
      resolveAgentSendDelivery({
        running: true,
        supportsSteer: true,
        behavior: "steer",
        alternate: true,
      }),
    ).toBe("queue");
    expect(
      resolveAgentSendDelivery({
        running: true,
        supportsSteer: true,
        behavior: "queue",
        alternate: true,
      }),
    ).toBe("steer");
  });

  it("always queues for an active provider without steering", () => {
    expect(
      resolveAgentSendDelivery({
        running: true,
        supportsSteer: false,
        behavior: "steer",
        alternate: true,
      }),
    ).toBe("queue");
  });
});
