import { describe, expect, it, vi } from "vitest";
import type {
  AgentModel,
  AgentRuntimeEnvelope,
  AgentSessionStats,
} from "@/lib/agents/types";

const mocks = vi.hoisted(() => ({
  startPiRpc: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  updateAgentSessionMetadata: vi.fn(),
  upsertAgentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/pi/client", () => ({
  startPiRpc: mocks.startPiRpc,
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
  updateAgentSessionMetadata: mocks.updateAgentSessionMetadata,
  upsertAgentSession: mocks.upsertAgentSession,
}));

import type { PiRpcClient } from "@/lib/agents/pi/client";
import type { PiRpcEvent } from "@/lib/agents/pi/protocol";
import type { OwnedAgentSession } from "@/lib/db/agentConnections";
import {
  AgentRuntimeRegistry,
  PiSessionRuntime,
} from "./registry";

const stats: AgentSessionStats = {
  sessionFile: "/sessions/native.jsonl",
  sessionId: "native",
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

const model: AgentModel = {
  id: "model",
  name: "Model",
  provider: "provider",
  api: "api",
  baseUrl: "",
  reasoning: true,
  input: ["text"],
  contextWindow: 100_000,
  maxTokens: 10_000,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
};

const idleProviderState = {
  sessionFile: "/sessions/native.jsonl",
  sessionId: "native",
  sessionName: null,
  model,
  thinkingLevel: "medium",
  autoCompactionEnabled: false,
  isStreaming: false,
  isCompacting: false,
};

class FakePiClient {
  private listeners = new Set<(event: PiRpcEvent) => void>();
  readonly stop = vi.fn(async () => {});
  readonly prompt = vi.fn(async () => ({}));
  readonly abort = vi.fn(async () => ({}));
  readonly setModel = vi.fn(async () => ({}));
  readonly setThinkingLevel = vi.fn(async () => ({}));
  readonly compact = vi.fn(async () => ({}));
  readonly setAutoCompaction = vi.fn(async () => ({}));
  readonly setSessionName = vi.fn(async () => ({}));
  readonly respondToExtensionUi = vi.fn();
  readonly getState = vi.fn(async () => ({ ...idleProviderState }));
  readonly getMessages = vi.fn(async () => ({ messages: [] }));
  readonly getAvailableModels = vi.fn(async () => [model]);
  readonly getSessionStats = vi.fn(async () => stats);
  readonly getAvailableThinkingLevels = vi.fn(async () => [
    "off",
    "medium",
  ]);
  readonly getCommands = vi.fn(async () => []);

  onEvent(listener: (event: PiRpcEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: PiRpcEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

function initial() {
  return {
    state: {
      sessionFile: "/sessions/native.jsonl",
      sessionId: "native",
      model,
      thinkingLevel: "medium",
      isStreaming: false,
    },
    messages: [],
    models: [model],
    thinkingLevels: ["off", "medium"] as const,
    commands: [],
    stats,
  };
}

function owned(): OwnedAgentSession {
  return {
    host: {
      id: "host",
      userId: "user",
      name: "This server",
      transport: "local",
      hostname: null,
      port: null,
      username: null,
      sshAuth: null,
      encryptedCredential: null,
      hostKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    connection: {
      id: "connection",
      hostId: "host",
      provider: "pi",
      executable: "pi",
      detectedVersion: "0.82.1",
      lastValidatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workspace: {
      id: "workspace",
      connectionId: "connection",
      path: "/workspace",
      name: "workspace",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    agentSession: {
      id: "session",
      workspaceId: "workspace",
      providerSessionId: "native",
      providerSessionPath: "/sessions/native.jsonl",
      name: null,
      firstMessage: null,
      messageCount: 0,
      providerCreatedAt: null,
      providerModifiedAt: null,
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("Pi session runtime", () => {
  it("executes Overtchat slash commands through native Pi RPC methods", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        state: {
          ...initial().state,
          autoCompactionEnabled: false,
        },
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({
      type: "prompt",
      message: "/compact focus on tests",
    });
    await runtime.command({
      type: "prompt",
      message: "/autocompact",
    });
    await runtime.command({
      type: "prompt",
      message: "/name Release prep",
    });

    expect(client.compact).toHaveBeenCalledWith("focus on tests");
    expect(client.setAutoCompaction).toHaveBeenCalledWith(true);
    expect(client.setSessionName).toHaveBeenCalledWith("Release prep");
    expect(client.prompt).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("queues prompts in OvertChat and drains them after Pi settles", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({
      type: "prompt",
      message: "/skill:docs explain caching",
    });
    expect(client.prompt).toHaveBeenCalledWith("/skill:docs explain caching");
    await runtime.command({
      type: "prompt",
      message: "Summarize after the current run",
    });
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().queuedMessages).toEqual([
      {
        id: "session:1",
        message: "Summarize after the current run",
      },
    ]);

    client.emit({ type: "agent_settled" });
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith(
        "Summarize after the current run",
      );
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    expect(client.compact).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("drains exactly one FIFO item for each settled run", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    await runtime.command({ type: "prompt", message: "Third" });
    client.emit({ type: "agent_settled" });
    client.emit({ type: "agent_settled" });

    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledTimes(2);
    });
    expect(client.prompt).toHaveBeenLastCalledWith("Second");
    expect(runtime.snapshot().queuedMessages).toEqual([
      { id: "session:2", message: "Third" },
    ]);

    client.emit({ type: "agent_settled" });
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledTimes(3);
    });
    expect(client.prompt).toHaveBeenLastCalledWith("Third");
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    await runtime.stop();
  });

  it("publishes narrow app-queue events without stale snapshots", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "omp",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );
    const events: AgentRuntimeEnvelope[] = [];
    const unsubscribe = runtime.subscribe((event) => events.push(event));

    await runtime.command({
      type: "prompt",
      message: "First",
    });
    await runtime.command({
      type: "prompt",
      message: "Second",
    });
    expect(runtime.snapshot().queuedMessages).toEqual([
      { id: "session:1", message: "Second" },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "pi_event",
        data: {
          type: "overtchat_queue_update",
          queuedMessages: [{ id: "session:1", message: "Second" }],
        },
      }),
    );
    expect(events.slice(2)).not.toContainEqual(
      expect.objectContaining({ type: "snapshot" }),
    );
    unsubscribe();
    await runtime.stop();
  });

  it("waits for abort acknowledgement before draining a queued prompt", async () => {
    const client = new FakePiClient();
    let resolveAbort = () => {};
    client.abort.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAbort = () => resolve({});
        }),
    );
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    const stopping = runtime.command({ type: "abort" });
    await Promise.resolve();
    expect(client.prompt).toHaveBeenCalledTimes(1);

    resolveAbort();
    await stopping;
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    await runtime.stop();
  });

  it("waits for confirmed provider idle after abort acknowledgement", async () => {
    const client = new FakePiClient();
    let resolveState: (state: typeof idleProviderState) => void = vi.fn();
    client.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        }),
    );
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    const stopping = runtime.command({ type: "abort" });
    await vi.waitFor(() => {
      expect(client.getState).toHaveBeenCalledTimes(1);
    });
    expect(client.prompt).toHaveBeenCalledTimes(1);
    resolveState(idleProviderState);
    await stopping;
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    await runtime.stop();
  });

  it("restores a queued message when normal prompt submission fails", async () => {
    const client = new FakePiClient();
    client.prompt
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Prompt rejected"));
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    client.emit({ type: "agent_settled" });
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledTimes(2);
      expect(runtime.snapshot().queuedMessages).toEqual([
        { id: "session:1", message: "Second" },
      ]);
      expect(runtime.snapshot().error).toBe("Prompt rejected");
    });
    expect(runtime.snapshot().status).toBe("idle");
    await runtime.stop();
  });

  it("drains after confirmed idle even when transcript refresh fails", async () => {
    const client = new FakePiClient();
    client.getMessages.mockRejectedValueOnce(new Error("History unavailable"));
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    client.emit({ type: "agent_settled" });

    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    await runtime.stop();
  });

  it("steers with a selected app-queued message after settled cancellation", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Queued first" });
    await runtime.command({ type: "prompt", message: "Steer with this" });
    const steering = runtime.command({
      type: "steer_queued_message",
      id: "session:2",
    });
    await steering;

    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Steer with this");
    });
    expect(client.abort).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().queuedMessages).toEqual([
      { id: "session:1", message: "Queued first" },
    ]);
    await runtime.stop();
  });

  it("removes an app-queued message without touching the provider", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Remove me" });
    await runtime.command({
      type: "remove_queued_message",
      id: "session:1",
    });

    expect(runtime.snapshot().queuedMessages).toEqual([]);
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(client.abort).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("ignores OMP extension cycles without assistant output", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "omp-session",
      "user",
      "connection",
      "workspace",
      "omp",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    client.emit({
      type: "agent_end",
      messages: [],
      willContinue: true,
    });
    await Promise.resolve();
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(client.getState).not.toHaveBeenCalled();

    client.emit({
      type: "agent_end",
      messages: [{ role: "assistant", content: [] }],
    });
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    await runtime.stop();
  });

  it("waits through OMP auto-compaction after assistant output", async () => {
    const client = new FakePiClient();
    let resolveState: (state: typeof idleProviderState) => void = vi.fn();
    client.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        }),
    );
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "omp",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    client.emit({
      type: "agent_end",
      messages: [{ role: "assistant", content: [] }],
      isTerminal: false,
      willContinue: true,
    });

    await vi.waitFor(() => {
      expect(client.getState).toHaveBeenCalledTimes(1);
    });
    expect(client.prompt).toHaveBeenCalledTimes(1);

    resolveState(idleProviderState);
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    await runtime.stop();
  });

  it("stops a stale OMP run and drains without another agent_end", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "omp",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    await runtime.command({ type: "abort" });

    expect(client.abort).toHaveBeenCalledTimes(1);
    expect(client.getState).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    await runtime.stop();
  });

  it("sends Stop while OMP is naturally settling after compaction", async () => {
    const client = new FakePiClient();
    client.getState
      .mockResolvedValueOnce({
        ...idleProviderState,
        isCompacting: true,
      })
      .mockResolvedValue({ ...idleProviderState });
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "omp",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    client.emit({
      type: "agent_end",
      messages: [{ role: "assistant", content: [] }],
      willContinue: true,
    });
    await vi.waitFor(() => {
      expect(client.getState).toHaveBeenCalledTimes(1);
    });

    await runtime.command({ type: "abort" });

    expect(client.abort).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    await runtime.stop();
  });

  it("restores a draining OMP message after a late prompt error", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "omp",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    client.emit({
      type: "agent_end",
      messages: [{ role: "assistant", content: [] }],
    });
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    client.emit({
      type: "rpc_error",
      command: "prompt",
      error: "Agent is already processing",
    });

    expect(runtime.snapshot().queuedMessages).toEqual([
      { id: "session:1", message: "Second" },
    ]);
    expect(runtime.snapshot().status).toBe("idle");
    expect(runtime.snapshot().error).toBe("Agent is already processing");
    await runtime.stop();
  });

  it("continues queued work after a direct OMP prompt is rejected late", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "omp",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "prompt", message: "Second" });
    client.emit({
      type: "rpc_error",
      command: "prompt",
      error: "Agent is already processing",
    });

    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenCalledWith("Second");
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    await runtime.stop();
  });

  it("replays sequenced events and ignores native provider queues", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      "pi",
      client as unknown as PiRpcClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );
    const first: unknown[] = [];
    const unsubscribeFirst = runtime.subscribe((event) => first.push(event));
    client.emit({ type: "turn_start" });
    client.emit({
      type: "queue_update",
      steering: ["Focus on the failing test"],
      followUp: ["Summarize the result"],
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);

    const replayed: unknown[] = [];
    const unsubscribeReplay = runtime.subscribe(
      (event) => replayed.push(event),
      1,
    );
    expect(replayed).toEqual([
      expect.objectContaining({ sequence: 2, type: "pi_event" }),
      expect.objectContaining({
        sequence: 3,
        type: "pi_event",
        data: expect.objectContaining({ type: "queue_update" }),
      }),
    ]);

    client.emit({
      type: "extension_ui_request",
      id: "question",
      method: "confirm",
      title: "Continue?",
    });
    expect(runtime.snapshot().pendingExtensionRequest).toMatchObject({
      id: "question",
    });

    await runtime.command({
      type: "extension_ui_response",
      id: "question",
      confirmed: true,
    });
    expect(client.respondToExtensionUi).toHaveBeenCalledWith("question", {
      confirmed: true,
    });
    expect(runtime.snapshot().pendingExtensionRequest).toBeUndefined();
    unsubscribeFirst();
    unsubscribeReplay();
    await runtime.stop();
  });

  it("deduplicates concurrent starts and stops matching owners", async () => {
    vi.clearAllMocks();
    const client = new FakePiClient();
    mocks.startPiRpc.mockReturnValue(client);
    const registry = new AgentRuntimeRegistry();
    const record = owned();

    const [first, second] = await Promise.all([
      registry.getOrStart(record),
      registry.getOrStart(record),
    ]);

    expect(first).toBe(second);
    expect(mocks.startPiRpc).toHaveBeenCalledTimes(1);
    await registry.stopWorkspace("workspace", "user");
    expect(client.stop).toHaveBeenCalledTimes(1);

    const secondClient = new FakePiClient();
    mocks.startPiRpc.mockReturnValue(secondClient);
    await registry.getOrStart(record);
    await registry.stopUser("user");
    expect(secondClient.stop).toHaveBeenCalledTimes(1);
  });
});
