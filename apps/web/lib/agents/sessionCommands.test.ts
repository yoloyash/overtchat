import { describe, expect, it } from "vitest";
import type { AgentRuntimeSnapshot } from "@overtchat/agent-bridge";
import { commandForAgentSessionSubmit } from "./sessionCommands";

function snapshot(
  overrides: Partial<AgentRuntimeSnapshot> = {},
): AgentRuntimeSnapshot {
  return {
    sessionId: "session",
    provider: "codex",
    capabilities: { steer: true, usage: true },
    status: "idle",
    activeTurn: null,
    state: {},
    messages: [],
    models: [],
    commands: [],
    stats: {
      sessionFile: null,
      sessionId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
      cost: 0,
    },
    queuedMessages: [],
    ...overrides,
  };
}

describe("commandForAgentSessionSubmit", () => {
  it("keeps usage out of the prompt queue while Codex is working", () => {
    expect(
      commandForAgentSessionSubmit(
        snapshot({ status: "running" }),
        "/usage",
        [],
      ),
    ).toEqual({ type: "show_usage" });
  });

  it("queues ordinary prompts while compaction is active", () => {
    expect(
      commandForAgentSessionSubmit(
        snapshot({ state: { isCompacting: true } }),
        "Continue with the tests",
        [],
      ),
    ).toEqual({ type: "queue", message: "Continue with the tests" });
  });

  it("keeps Plan and Fast toggles out of the queue while Codex is working", () => {
    const working = snapshot({
      status: "running",
      state: {
        collaborationMode: "default",
        collaborationModes: ["default", "plan"],
        fastModeAvailable: true,
        fastModeEnabled: false,
      },
    });
    expect(commandForAgentSessionSubmit(working, "/plan", [])).toEqual({
      type: "set_collaboration_mode",
      mode: "plan",
    });
    expect(commandForAgentSessionSubmit(working, "/fast", [])).toEqual({
      type: "set_fast_mode",
      enabled: true,
    });
  });

  it("does not intercept usage for providers that do not advertise it", () => {
    expect(
      commandForAgentSessionSubmit(
        snapshot({ capabilities: { steer: true } }),
        "/usage",
        [],
      ),
    ).toEqual({ type: "prompt", message: "/usage" });
  });
});
