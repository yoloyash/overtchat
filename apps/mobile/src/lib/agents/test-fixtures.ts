import type { AgentRuntimeSnapshot } from "@overtchat/agent-bridge";
export function snapshot(
  status: AgentRuntimeSnapshot["status"] = "idle",
): AgentRuntimeSnapshot {
  return {
    sessionId: "session",
    provider: "codex",
    capabilities: { steer: true, usage: true },
    status,
    activeTurn: null,
    state: {},
    messages: [],
    models: [],
    commands: [],
    queuedMessages: [],
    stats: {
      sessionFile: null,
      sessionId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    },
  };
}
