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
  readonly setSessionName = vi.fn(async () => ({}));
  readonly respondToExtensionUi = vi.fn();
  readonly getState = vi.fn(async () => ({
    sessionFile: "/sessions/native.jsonl",
    sessionId: "native",
    sessionName: null,
    model,
    thinkingLevel: "medium",
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
  it("replays sequenced events and clears answered extension requests", async () => {
    const client = new FakePiClient();
    const runtime = new PiSessionRuntime(
      "session",
      "user",
      "connection",
      "workspace",
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

    const replayed: unknown[] = [];
    const unsubscribeReplay = runtime.subscribe(
      (event) => replayed.push(event),
      1,
    );
    expect(replayed).toEqual([
      expect.objectContaining({ sequence: 2, type: "pi_event" }),
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

  it("deduplicates concurrent starts and stops matching workspaces", async () => {
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
  });
});
