import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startPiRpc: vi.fn(),
  probeAgentTarget: vi.fn(),
  listAgentWorkspaceSessions: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/pi/client", () => ({
  startPiRpc: mocks.startPiRpc,
}));
vi.mock("@overtchat/agent-runtime/pi/probe", () => ({
  probeAgentTarget: mocks.probeAgentTarget,
}));
vi.mock("@overtchat/agent-runtime/pi/sessions", () => ({
  listAgentWorkspaceSessions: mocks.listAgentWorkspaceSessions,
}));

import { createPiRpcProviderAdapter } from "./pi-rpc";

function rawClient() {
  return {
    onEvent: vi.fn(),
    getState: vi.fn(),
    getMessages: vi.fn(),
    getAvailableModels: vi.fn(),
    getSessionStats: vi.fn(),
    getAvailableThinkingLevels: vi.fn(),
    getCommands: vi.fn(),
    prompt: vi.fn(),
    steer: vi.fn(),
    abort: vi.fn(),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    compact: vi.fn(),
    setAutoCompaction: vi.fn(),
    setSessionName: vi.fn(),
    respondToExtensionUi: vi.fn(),
    respondToInteraction: vi.fn(),
    stop: vi.fn(),
  };
}

describe("Pi RPC provider adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps new and resumed sessions to Pi RPC launches", () => {
    const client = rawClient();
    mocks.startPiRpc.mockReturnValue(client);
    const adapter = createPiRpcProviderAdapter("omp");
    const target = {
      connectorId: "connector",
      transport: "ssh" as const,
      alias: "workstation",
      shellMode: "interactive" as const,
    };

    adapter.startSession(target, {
      executable: "/home/user/.bun/bin/omp",
      cwd: "/workspace",
      resume: {
        providerSessionId: "native-session",
        providerSessionPath: "/sessions/native.jsonl",
      },
    });
    expect(mocks.startPiRpc).toHaveBeenCalledWith(target, {
      provider: "omp",
      executable: "/home/user/.bun/bin/omp",
      cwd: "/workspace",
      sessionPath: "/sessions/native.jsonl",
    });
  });

  it("keeps session-file identity inside the provider adapter", () => {
    const adapter = createPiRpcProviderAdapter("pi");

    expect(
      adapter.sessionIdentity({
        sessionFile: "/sessions/native.jsonl",
        sessionId: "native-session",
        sessionName: "Refactor providers",
      }),
    ).toEqual({
      providerSessionPath: "/sessions/native.jsonl",
      providerSessionId: "native-session",
      sessionName: "Refactor providers",
    });
    expect(() => adapter.sessionIdentity({ sessionId: "native" })).toThrow(
      "Pi did not create a persistent session file.",
    );
  });

  it("uses the registered provider when probing a connection draft", async () => {
    const probe = {
      status: "ready" as const,
      version: "1.2.3",
      models: [],
      shellMode: "interactive" as const,
    };
    mocks.probeAgentTarget.mockResolvedValue(probe);
    const adapter = createPiRpcProviderAdapter("pi");

    await expect(
      adapter.probeConnection({
        provider: "omp",
        connectorId: "connector",
        transport: "ssh",
        sshAlias: "workstation",
        name: "Workstation",
        executable: "/usr/local/bin/pi",
      }),
    ).resolves.toBe(probe);
    expect(mocks.probeAgentTarget).toHaveBeenCalledWith(
      {
        transport: "ssh",
        alias: "workstation",
      },
      "pi",
      "/usr/local/bin/pi",
    );
  });

  it("classifies Pi settlement without exposing it to the shared runtime", () => {
    const classifier =
      createPiRpcProviderAdapter("pi").createEventClassifier();

    expect(classifier.classify({ type: "turn_start" })).toEqual({
      started: true,
      terminal: false,
    });
    expect(classifier.classify({ type: "agent_settled" })).toEqual({
      started: false,
      terminal: true,
    });
  });

  it("waits for OMP assistant output before treating agent_end as terminal", () => {
    const classifier =
      createPiRpcProviderAdapter("omp").createEventClassifier();

    expect(classifier.classify({ type: "agent_start" }).started).toBe(true);
    expect(classifier.classify({ type: "agent_end" }).terminal).toBe(false);
    classifier.classify({
      type: "message_update",
      message: { role: "assistant", content: "Done" },
    });
    expect(classifier.classify({ type: "agent_end" }).terminal).toBe(true);
  });

  it("normalizes command updates and provider-owned prompt completion", () => {
    const adapter = createPiRpcProviderAdapter("omp");

    expect(
      adapter.commandsFromEvent({
        type: "available_commands_update",
        commands: [
          {
            name: "model",
            description: "Select a model",
            source: "builtin",
          },
        ],
      }),
    ).toEqual(
      [
        expect.objectContaining({ name: "model" }),
      ],
    );
    expect(
      adapter
        .createEventClassifier()
        .classify({
          type: "prompt_result",
          agentInvoked: false,
        }).terminal,
    ).toBe(true);
  });

  it("keeps provider command capabilities inside the adapter", () => {
    const pi = createPiRpcProviderAdapter("pi");
    const omp = createPiRpcProviderAdapter("omp");

    expect(pi.mergeCommands([])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "compact", source: "builtin" }),
      ]),
    );
    expect(omp.mergeCommands([])).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "compact", source: "builtin" }),
      ]),
    );
  });
});
