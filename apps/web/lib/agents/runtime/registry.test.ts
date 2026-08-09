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

import { agentProviderAdapter } from "@/lib/agents/providers/registry";
import type {
  AgentRuntimeClient,
  AgentRuntimeEvent,
} from "@/lib/agents/providers/types";
import type { OwnedAgentSession } from "@/lib/db/agentConnections";
import {
  AgentRuntimeRegistry,
  AgentSessionRuntime,
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

class FakeAgentClient {
  private listeners = new Set<(event: AgentRuntimeEvent) => void>();
  readonly stop = vi.fn(async () => {});
  readonly prompt = vi.fn(async () => ({}));
  readonly steer = vi.fn(async () => ({}));
  readonly followUp = vi.fn(async () => ({}));
  readonly abort = vi.fn(async () => ({}));
  readonly setModel = vi.fn(async () => ({}));
  readonly setThinkingLevel = vi.fn(async () => ({}));
  readonly compact = vi.fn(async () => ({}));
  readonly setAutoCompaction = vi.fn(async () => ({}));
  readonly setSessionName = vi.fn(async () => ({}));
  readonly retryInteractive = vi.fn(async () => ({}));
  readonly forkSession = vi.fn(async () => ({
    session: {
      providerSessionId: "native-fork",
      providerSessionPath: "/sessions/native-fork.jsonl",
      name: null,
      firstMessage: "Earlier prompt",
      messageCount: 2,
      createdAt: new Date(1_000),
      modifiedAt: new Date(2_000),
    },
    draft: "Edit this prompt",
  }));
  readonly discardForkedSession = vi.fn(async () => {});
  readonly respondToInteraction = vi.fn();
  readonly respondToExtensionUi = this.respondToInteraction;
  readonly getState = vi.fn(async () => ({ ...idleProviderState }));
  readonly getMessages = vi.fn(async () => ({ messages: [] }));
  readonly getAvailableModels = vi.fn(async () => [model]);
  readonly getSessionStats = vi.fn(async () => stats);
  readonly getAvailableThinkingLevels = vi.fn(async () => [
    "off",
    "medium",
  ]);
  readonly getCommands = vi.fn(async () => []);

  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentRuntimeEvent) {
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
      connectorId: "connector",
      name: "This machine",
      transport: "local",
      sshAlias: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    connection: {
      id: "connection",
      hostId: "host",
      provider: "pi",
      executable: "pi",
      shellMode: "interactive",
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

describe("Agent session runtime", () => {
  it("blocks mutations in read-only sessions and retries interactive access", async () => {
    const client = new FakeAgentClient();
    const readOnly = {
      reason: "This session is open elsewhere.",
      retryable: true,
    };
    client.getState.mockResolvedValueOnce({ ...idleProviderState });
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        state: { ...initial().state, readOnly },
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    expect(runtime.snapshot().readOnly).toEqual(readOnly);
    await expect(
      runtime.command({ type: "prompt", message: "Continue" }),
    ).rejects.toThrow("open elsewhere");
    expect(client.prompt).not.toHaveBeenCalled();

    await runtime.command({ type: "retry_interactive" });
    expect(client.retryInteractive).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().readOnly).toBeUndefined();
    await runtime.stop();
  });

  it("keeps live provider messages in authoritative snapshots", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "Inspect the runtime" });
    const startedAt = runtime.snapshot().activeTurn?.startedAt;
    client.emit({
      type: "message_end",
      message: {
        role: "user",
        content: "Inspect the runtime",
        timestamp: 10,
      },
    });
    client.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Still working" }],
        timestamp: 20,
      },
    });

    expect(startedAt).toEqual(expect.any(Number));
    expect(runtime.snapshot()).toMatchObject({
      capabilities: { steer: true },
      status: "running",
      activeTurn: { startedAt },
      messages: [
        {
          role: "user",
          content: "Inspect the runtime",
          timestamp: 10,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Still working" }],
          timestamp: 20,
        },
      ],
    });

    client.emit({ type: "agent_settled" });
    await vi.waitFor(() => {
      expect(runtime.snapshot().activeTurn).toBeNull();
    });
    await runtime.stop();
  });

  it("keeps provider built-ins when discovered commands refresh", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    client.emit({
      type: "available_commands_update",
      commands: [
        {
          name: "release-notes",
          description: "Draft release notes",
          source: "extension",
        },
      ],
    });

    expect(runtime.snapshot().commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "compact" }),
        expect.objectContaining({ name: "new" }),
        expect.objectContaining({ name: "release-notes" }),
      ]),
    );
    await runtime.stop();
  });

  it("moves an accepted prompt into the transcript without duplicating an early provider echo", async () => {
    const client = new FakeAgentClient();
    let acceptPrompt: () => void = vi.fn();
    client.prompt.mockImplementationOnce(
      () =>
        new Promise<object>((resolve) => {
          acceptPrompt = () => resolve({});
        }),
    );
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    const submitting = runtime.command({
      type: "prompt",
      message: "Inspect the runtime",
    });
    expect(runtime.snapshot().messages).toEqual([]);

    client.emit({
      type: "message_start",
      message: {
        role: "user",
        content: "Inspect the runtime",
        timestamp: 10,
      },
    });
    acceptPrompt();
    await submitting;

    expect(runtime.snapshot().messages).toEqual([
      {
        role: "user",
        content: "Inspect the runtime",
        timestamp: 10,
      },
    ]);
    await runtime.stop();
  });

  it("executes Overtchat slash commands through native Pi RPC methods", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
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

  it("runs OMP compaction out of band and refreshes session usage", async () => {
    const client = new FakeAgentClient();
    const compactedStats = {
      ...stats,
      tokens: {
        ...stats.tokens,
        input: 27_603,
        total: 27_603,
      },
      contextUsage: {
        tokens: 27_603,
        contextWindow: 131_072,
        percent: 21.06,
      },
    };
    client.getSessionStats.mockResolvedValueOnce(compactedStats);
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({
      type: "prompt",
      message: "/compact focus on tests",
    });

    expect(client.compact).toHaveBeenCalledWith("focus on tests");
    expect(client.prompt).not.toHaveBeenCalled();
    expect(client.getSessionStats).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().stats).toEqual(compactedStats);
    await runtime.stop();
  });

  it("owns queued messages independently of the provider queue", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
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
    await runtime.command({ type: "queue", message: "Second" });
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(client.followUp).not.toHaveBeenCalled();
    expect(runtime.snapshot().queuedMessages).toEqual([
      {
        id: "session:1",
        message: "Second",
        status: "pending",
      },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "runtime_event",
        data: {
          type: "overtchat_queue_update",
          queuedMessages: [
            {
              id: "session:1",
              message: "Second",
              status: "pending",
            },
          ],
        },
      }),
    );

    client.emit({
      type: "queue_update",
      steering: ["Provider-owned"],
      followUp: ["Provider-owned"],
    });
    expect(runtime.snapshot().queuedMessages).toEqual([
      {
        id: "session:1",
        message: "Second",
        status: "pending",
      },
    ]);

    client.emit({ type: "agent_settled" });
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenNthCalledWith(2, "Second");
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    unsubscribe();
    await runtime.stop();
  });

  it("steers the active turn without aborting or duplicating an early provider echo", async () => {
    const client = new FakeAgentClient();
    let acceptSteer: () => void = vi.fn();
    client.steer.mockImplementationOnce(
      () =>
        new Promise<object>((resolve) => {
          acceptSteer = () => resolve({});
        }),
    );
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    const steering = runtime.command({
      type: "steer",
      message: "Focus on the failing test",
    });
    client.emit({
      type: "message_end",
      message: {
        role: "user",
        content: "Focus on the failing test",
        timestamp: 20,
      },
    });
    acceptSteer();
    await steering;

    expect(client.steer).toHaveBeenCalledWith(
      "Focus on the failing test",
    );
    expect(client.abort).not.toHaveBeenCalled();
    expect(
      runtime
        .snapshot()
        .messages.filter(
          (message) =>
            message &&
            typeof message === "object" &&
            Reflect.get(message, "content") ===
              "Focus on the failing test",
        ),
    ).toHaveLength(1);
    await runtime.stop();
  });

  it("does not turn a prompt into an implicit interrupt", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await expect(
      runtime.command({
        type: "prompt",
        message: "Send this now",
      }),
    ).rejects.toThrow(
      "Pi is already working. Queue the message or steer the active turn.",
    );

    expect(client.abort).not.toHaveBeenCalled();
    expect(client.prompt).toHaveBeenNthCalledWith(1, "First");
    expect(client.steer).not.toHaveBeenCalled();
    expect(client.followUp).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("steers with a selected queued message and preserves FIFO order", async () => {
    const client = new FakeAgentClient();
    let acceptSteer: () => void = vi.fn();
    client.steer.mockImplementationOnce(
      () =>
        new Promise<object>((resolve) => {
          acceptSteer = () => resolve({});
        }),
    );
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "queue", message: "Second" });
    await runtime.command({ type: "queue", message: "Third" });
    const steering = runtime.command({
      type: "steer_queued_message",
      id: "session:2",
    });

    expect(client.steer).toHaveBeenCalledWith("Third");
    expect(runtime.snapshot().queuedMessages).toEqual([
      {
        id: "session:1",
        message: "Second",
        status: "pending",
      },
      {
        id: "session:2",
        message: "Third",
        status: "sending",
      },
    ]);
    acceptSteer();
    await steering;

    expect(client.abort).not.toHaveBeenCalled();
    expect(client.prompt).toHaveBeenNthCalledWith(1, "First");
    expect(runtime.snapshot().queuedMessages).toEqual([
      {
        id: "session:1",
        message: "Second",
        status: "pending",
      },
    ]);
    expect(runtime.snapshot().messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: "Third",
        overtchatSubmissionId: "session:2",
      }),
    );
    await runtime.stop();
  });

  it("keeps a queued message pending when steering fails", async () => {
    const client = new FakeAgentClient();
    client.steer.mockRejectedValueOnce(
      new Error("Provider rejected the steering message"),
    );
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "queue", message: "Second" });
    await expect(
      runtime.command({
        type: "steer_queued_message",
        id: "session:1",
      }),
    ).rejects.toThrow("Provider rejected the steering message");

    expect(client.abort).not.toHaveBeenCalled();
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      status: "running",
      error: "Provider rejected the steering message",
      queuedMessages: [
        {
          id: "session:1",
          message: "Second",
          status: "pending",
        },
      ],
      messages: [
        expect.objectContaining({
          role: "user",
          content: "First",
        }),
      ],
    });
    await runtime.stop();
  });

  it("settles immediately after abort acknowledgement", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "abort" });

    expect(client.abort).toHaveBeenCalledTimes(1);
    expect(client.getState).not.toHaveBeenCalled();
    expect(runtime.snapshot().status).toBe("idle");
    expect(client.prompt).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });

  it("keeps the active turn running when abort is rejected", async () => {
    const client = new FakeAgentClient();
    client.abort.mockRejectedValueOnce(new Error("Abort rejected"));
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "queue", message: "Second" });

    await expect(runtime.command({ type: "abort" })).rejects.toThrow(
      "Abort rejected",
    );

    expect(client.getState).not.toHaveBeenCalled();
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      status: "running",
      error: "Abort rejected",
      queuedMessages: [
        {
          id: "session:1",
          message: "Second",
          status: "pending",
        },
      ],
    });
    await runtime.stop();
  });

  it("resets runtime state when normal prompt submission fails", async () => {
    const client = new FakeAgentClient();
    client.prompt.mockRejectedValueOnce(new Error("Prompt rejected"));
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await expect(
      runtime.command({ type: "prompt", message: "First" }),
    ).rejects.toThrow("Prompt rejected");
    expect(runtime.snapshot().status).toBe("idle");
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    expect(runtime.snapshot().messages).toEqual([]);
    expect(runtime.snapshot().error).toBe("Prompt rejected");
    await runtime.stop();
  });

  it("settles provider idle even when transcript refresh fails", async () => {
    const client = new FakeAgentClient();
    client.getMessages.mockRejectedValueOnce(new Error("History unavailable"));
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    client.emit({ type: "agent_settled" });

    await vi.waitFor(() => {
      expect(runtime.snapshot().status).toBe("idle");
    });
    expect(client.prompt).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });

  it("ignores OMP extension cycles without assistant output", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "omp-session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "queue", message: "Second" });
    expect(client.followUp).not.toHaveBeenCalled();
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
      expect(client.prompt).toHaveBeenNthCalledWith(2, "Second");
    });
    expect(runtime.snapshot().status).toBe("running");
    await runtime.stop();
  });

  it("waits through OMP auto-compaction after assistant output", async () => {
    const client = new FakeAgentClient();
    let resolveState: (state: typeof idleProviderState) => void = vi.fn();
    client.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        }),
    );
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "queue", message: "Second" });
    expect(client.followUp).not.toHaveBeenCalled();
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
      expect(client.prompt).toHaveBeenNthCalledWith(2, "Second");
    });
    expect(runtime.snapshot().status).toBe("running");
    await runtime.stop();
  });

  it("stops polling and preserves the queue when OMP never becomes idle", async () => {
    vi.useFakeTimers();
    const client = new FakeAgentClient();
    client.getState.mockResolvedValue({
      ...idleProviderState,
      isStreaming: false,
      isCompacting: true,
    });
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    try {
      await runtime.command({ type: "prompt", message: "First" });
      await runtime.command({
        type: "queue",
        message: "Second",
      });
      client.emit({
        type: "agent_end",
        messages: [{ role: "assistant", content: [] }],
      });

      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();

      expect(runtime.snapshot()).toMatchObject({
        status: "running",
        error: expect.stringContaining(
          "still reports that it is working after 30 seconds",
        ),
        queuedMessages: [
          {
            id: "session:1",
            message: "Second",
            status: "pending",
          },
        ],
      });
      expect(client.prompt).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.stop();
      vi.useRealTimers();
    }
  });

  it("cancels provider-idle reconciliation when the runtime stops", async () => {
    const client = new FakeAgentClient();
    let resolveState: (state: typeof idleProviderState) => void = vi.fn();
    client.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        }),
    );
    const onExit = vi.fn();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      onExit,
    );

    await runtime.command({ type: "prompt", message: "First" });
    client.emit({
      type: "agent_end",
      messages: [{ role: "assistant", content: [] }],
    });
    await vi.waitFor(() => {
      expect(client.getState).toHaveBeenCalledTimes(1);
    });

    await runtime.stop();
    resolveState({
      ...idleProviderState,
      isStreaming: true,
    });
    await Promise.resolve();

    expect(runtime.snapshot().status).toBe("exited");
    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("drains the OvertChat queue after Stop is acknowledged", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "queue", message: "Second" });
    await runtime.command({ type: "abort" });

    expect(client.abort).toHaveBeenCalledTimes(1);
    expect(client.getState).not.toHaveBeenCalled();
    expect(client.followUp).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(client.prompt).toHaveBeenNthCalledWith(2, "Second");
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    await runtime.stop();
  });

  it("supersedes an in-flight provider idle poll when Stop is acknowledged", async () => {
    const client = new FakeAgentClient();
    let resolveState: (state: typeof idleProviderState) => void = vi.fn();
    client.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        }),
    );
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("omp"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({ type: "prompt", message: "First" });
    await runtime.command({ type: "queue", message: "Second" });
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
      expect(client.prompt).toHaveBeenNthCalledWith(2, "Second");
    });
    expect(runtime.snapshot().status).toBe("running");

    resolveState({
      ...idleProviderState,
      isStreaming: true,
    });
    await Promise.resolve();

    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().status).toBe("running");
    await runtime.stop();
  });

  it("replays sequenced provider and OvertChat queue events", async () => {
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );
    const first: unknown[] = [];
    const unsubscribeFirst = runtime.subscribe((event) => first.push(event));
    client.emit({ type: "turn_start" });
    await runtime.command({
      type: "queue",
      message: "Summarize the result",
    });
    expect(runtime.snapshot().queuedMessages).toEqual([
      {
        id: "session:1",
        message: "Summarize the result",
        status: "pending",
      },
    ]);

    const replayed: unknown[] = [];
    const unsubscribeReplay = runtime.subscribe(
      (event) => replayed.push(event),
      1,
    );
    expect(replayed).toEqual([
      expect.objectContaining({ sequence: 2, type: "runtime_event" }),
      expect.objectContaining({
        sequence: 3,
        type: "runtime_event",
        data: expect.objectContaining({
          type: "overtchat_queue_update",
        }),
      }),
    ]);

    client.emit({
      type: "interaction_request",
      id: "question",
      method: "confirm",
      title: "Continue?",
    });
    expect(runtime.snapshot().pendingInteraction).toMatchObject({
      id: "question",
    });

    client.respondToInteraction.mockImplementationOnce(() => {
      client.emit({
        type: "interaction_request",
        id: "question",
        method: "input",
        title: "Follow-up",
      });
    });
    await runtime.command({
      type: "interaction_response",
      id: "question",
      confirmed: true,
    });
    expect(client.respondToInteraction).toHaveBeenCalledWith("question", {
      confirmed: true,
    });
    expect(runtime.snapshot().pendingInteraction).toMatchObject({
      id: "question",
      title: "Follow-up",
    });
    client.emit({ type: "interaction_resolved", id: "question" });
    expect(runtime.snapshot().pendingInteraction).toBeUndefined();
    unsubscribeFirst();
    unsubscribeReplay();
    await runtime.stop();
  });

  it("persists provider-native history forks as new sessions", async () => {
    vi.clearAllMocks();
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );
    mocks.upsertAgentSession.mockResolvedValue({
      ...owned().agentSession,
      id: "forked-session",
      providerSessionId: "native-fork",
      providerSessionPath: "/sessions/native-fork.jsonl",
    });
    const registry = new AgentRuntimeRegistry();

    await expect(
      registry.fork(owned(), runtime, {
        type: "edit_message",
        messageId: "user-message",
      }),
    ).resolves.toEqual({
      sessionId: "forked-session",
      draft: "Edit this prompt",
    });
    expect(client.forkSession).toHaveBeenCalledWith(
      "user-message",
      "edit",
    );
    expect(mocks.upsertAgentSession).toHaveBeenCalledWith("workspace", {
      providerSessionId: "native-fork",
      providerSessionPath: "/sessions/native-fork.jsonl",
      name: null,
      firstMessage: "Earlier prompt",
      messageCount: 2,
      createdAt: new Date(1_000),
      modifiedAt: new Date(2_000),
    });
    await runtime.stop();
  });

  it("discards a native fork when local session persistence fails", async () => {
    vi.clearAllMocks();
    const client = new FakeAgentClient();
    const runtime = new AgentSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
      agentProviderAdapter("pi"),
      client as unknown as AgentRuntimeClient,
      {
        ...initial(),
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );
    mocks.upsertAgentSession.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const registry = new AgentRuntimeRegistry();

    await expect(
      registry.fork(owned(), runtime, {
        type: "fork_message",
        messageId: "assistant-message",
      }),
    ).rejects.toThrow("database unavailable");
    expect(client.discardForkedSession).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: "native-fork" }),
    );
    await runtime.stop();
  });

  it("deduplicates concurrent starts and stops matching owners", async () => {
    vi.clearAllMocks();
    const client = new FakeAgentClient();
    mocks.startPiRpc.mockReturnValue(client);
    const registry = new AgentRuntimeRegistry();
    const record = owned();

    const [first, second] = await Promise.all([
      registry.getOrStart(record),
      registry.getOrStart(record),
    ]);

    expect(first).toBe(second);
    expect(mocks.startPiRpc).toHaveBeenCalledTimes(1);
    expect(registry.runtimeStatusForSession("session", "user")).toBe("idle");
    expect(registry.runtimeStatusForSession("session", "another-user")).toBe(
      "idle",
    );
    client.emit({ type: "turn_start" });
    expect(registry.runtimeStatusForSession("session", "user")).toBe(
      "running",
    );
    await registry.stopWorkspace("workspace", "user");
    expect(client.stop).toHaveBeenCalledTimes(1);

    const secondClient = new FakeAgentClient();
    mocks.startPiRpc.mockReturnValue(secondClient);
    await registry.getOrStart(record);
    await registry.stopUser("user");
    expect(secondClient.stop).toHaveBeenCalledTimes(1);
  });
});
