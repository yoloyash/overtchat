import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  stop: vi.fn(),
  saveQueue: vi.fn(),
}));

const stats = {
  sessionFile: null,
  sessionId: "provider-session",
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
};

vi.mock("@overtchat/agent-runtime/providers/registry", () => ({
  agentProviderAdapter: () => ({
    provider: "codex",
    capabilities: { steer: true },
    probeConnection: vi.fn(),
    probeTarget: vi.fn(),
    listWorkspaceSessions: vi.fn(),
    startSession: () => ({
      onEvent: vi.fn(),
      getState: vi.fn().mockResolvedValue({
        isStreaming: false,
        sessionId: "provider-session",
        sessionFile: "/sessions/provider-session.jsonl",
      }),
      getMessages: vi.fn().mockResolvedValue({ messages: [] }),
      getAvailableModels: vi.fn().mockResolvedValue([
        { provider: "openai", id: "gpt-5", name: "GPT-5", input: ["text"] },
      ]),
      getSessionStats: vi.fn().mockResolvedValue(stats),
      getAvailableThinkingLevels: vi.fn().mockResolvedValue([]),
      getCommands: vi.fn().mockResolvedValue([]),
      prompt: mocks.prompt,
      stop: mocks.stop,
    }),
    sessionIdentity: () => ({
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      sessionName: null,
    }),
    createEventClassifier: () => ({
      classify: () => ({ started: false, ended: false }),
      reset: vi.fn(),
    }),
    commandsFromEvent: () => null,
    mergeCommands: (commands: unknown[]) => commands,
    normalizeCommand: (command: unknown) => command,
  }),
}));

import { AgentRuntimeRegistry } from "./registry.js";

describe("agent runtime queue recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prompt.mockResolvedValue({ accepted: true });
    mocks.stop.mockResolvedValue(undefined);
    mocks.saveQueue.mockResolvedValue(undefined);
  });

  it("resubmits a journaled queue item with its original message identity", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "message-1",
          message: "Continue the task",
          status: "sending",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
    });

    await registry.getOrStart({
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "codex",
      target: { transport: "local" },
      executable: "codex",
      cwd: "/workspace",
      sessionId: "session",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
    });

    await vi.waitFor(() => {
      expect(mocks.prompt).toHaveBeenCalledWith(
        "Continue the task",
        undefined,
        { clientMessageId: "message-1" },
      );
    });
    await vi.waitFor(() => {
      expect(mocks.saveQueue).toHaveBeenLastCalledWith("session", []);
    });
    await registry.stopAll();
  });
});
