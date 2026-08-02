import { describe, expect, it, vi } from "vitest";
import type {
  AgentModel,
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
  readonly getState = vi.fn(async () => ({
    sessionFile: "/sessions/native.jsonl",
    sessionId: "native",
    sessionName: null,
    model,
    thinkingLevel: "medium",
    autoCompactionEnabled: false,
    isStreaming: false,
  }));
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

  it("forwards Pi-discovered slash commands through prompt", async () => {
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

    expect(client.prompt).toHaveBeenCalledWith(
      "/skill:docs explain caching",
      undefined,
    );
    await runtime.command({
      type: "prompt",
      message: "Summarize after the current run",
      streamingBehavior: "followUp",
    });
    expect(client.prompt).toHaveBeenCalledWith(
      "Summarize after the current run",
      "followUp",
    );
    expect(runtime.snapshot().queuedMessages).toEqual({
      steering: [],
      followUp: [],
    });
    expect(client.compact).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("mirrors OMP pending messages until their user turns begin", async () => {
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

    await runtime.command({
      type: "prompt",
      message: "Summarize after the current run",
      streamingBehavior: "followUp",
    });
    await runtime.command({
      type: "prompt",
      message: "Focus on the failing test",
      streamingBehavior: "steer",
    });
    expect(runtime.snapshot().queuedMessages).toEqual({
      steering: ["Focus on the failing test"],
      followUp: ["Summarize after the current run"],
    });

    client.emit({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: "Focus on the failing test" }],
        steering: true,
        timestamp: 1,
      },
    });
    expect(runtime.snapshot().queuedMessages).toEqual({
      steering: [],
      followUp: ["Summarize after the current run"],
    });

    client.emit({
      type: "message_start",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Summarize after the current run" },
        ],
        timestamp: 2,
      },
    });
    expect(runtime.snapshot().queuedMessages).toEqual({
      steering: [],
      followUp: [],
    });
    await runtime.stop();
  });

  it("rolls back an OMP pending message when submission fails", async () => {
    const client = new FakePiClient();
    client.prompt.mockRejectedValueOnce(new Error("Queue rejected"));
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

    await expect(
      runtime.command({
        type: "prompt",
        message: "Try this later",
        streamingBehavior: "followUp",
      }),
    ).rejects.toThrow("Queue rejected");
    expect(runtime.snapshot().queuedMessages).toEqual({
      steering: [],
      followUp: [],
    });
    await runtime.stop();
  });

  it("forwards OMP native compact commands and settles on agent_end", async () => {
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
        commands: [
          {
            name: "compact",
            source: "builtin",
          },
        ],
        thinkingLevels: [...initial().thinkingLevels],
      },
      vi.fn(),
    );

    await runtime.command({
      type: "prompt",
      message: "/compact focus on tests",
    });
    client.emit({ type: "agent_start" });
    expect(runtime.snapshot().status).toBe("running");
    client.emit({ type: "agent_end", messages: [] });

    expect(client.prompt).toHaveBeenCalledWith(
      "/compact focus on tests",
      undefined,
    );
    expect(runtime.snapshot().queuedMessages).toEqual({
      steering: [],
      followUp: [],
    });
    expect(client.compact).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(runtime.snapshot().status).toBe("idle");
    });
    await runtime.stop();
  });

  it("replays sequenced events and clears answered extension requests", async () => {
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
    expect(runtime.snapshot().queuedMessages).toEqual({
      steering: ["Focus on the failing test"],
      followUp: ["Summarize the result"],
    });

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
