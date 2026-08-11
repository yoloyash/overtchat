import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderId } from "@overtchat/agent-bridge";
import type { AgentRuntimeEvent } from "@overtchat/agent-runtime/providers/types";

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  steer: vi.fn(),
  abort: vi.fn(),
  stop: vi.fn(),
  saveQueue: vi.fn(),
  eventSubscriber: null as ((event: AgentRuntimeEvent) => void) | null,
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
  agentProviderAdapter: (provider: AgentProviderId) => ({
    provider,
    capabilities: { steer: true },
    probeConnection: vi.fn(),
    probeTarget: vi.fn(),
    listWorkspaceSessions: vi.fn(),
    startSession: () => ({
      onEvent: vi.fn((subscriber: (event: AgentRuntimeEvent) => void) => {
        mocks.eventSubscriber = subscriber;
        return vi.fn();
      }),
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
      steer: mocks.steer,
      abort: mocks.abort,
      stop: mocks.stop,
    }),
    sessionIdentity: () => ({
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      sessionName: null,
    }),
    createEventClassifier: () => ({
      classify: (event: AgentRuntimeEvent) => ({
        started: event.type === "agent_start",
        terminal: event.type === "agent_end",
      }),
      reset: vi.fn(),
    }),
    commandsFromEvent: () => null,
    mergeCommands: (commands: unknown[]) => commands,
    normalizeCommand: (command: unknown) => command,
  }),
}));

import { AgentRuntimeRegistry } from "./registry.js";

describe("agent runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prompt.mockResolvedValue({ accepted: true });
    mocks.steer.mockResolvedValue({ accepted: true });
    mocks.abort.mockResolvedValue({ interrupted: true });
    mocks.stop.mockResolvedValue(undefined);
    mocks.saveQueue.mockResolvedValue(undefined);
    mocks.eventSubscriber = null;
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

  it("drains queued messages once in FIFO order as turns become idle", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await runtime.command(
      { type: "prompt", message: "Start the task" },
      "initial-message",
    );
    await runtime.command(
      { type: "queue", message: "First follow-up" },
      "queued-first",
    );
    await runtime.command(
      { type: "queue", message: "Second follow-up" },
      "queued-second",
    );

    mocks.eventSubscriber?.({ type: "agent_end", messages: [] });
    await vi.waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(2));
    expect(mocks.prompt.mock.calls[1]).toEqual([
      "First follow-up",
      undefined,
      { clientMessageId: "queued-first" },
    ]);
    expect(runtime.snapshot().queuedMessages).toEqual([
      expect.objectContaining({
        id: "queued-second",
        status: "pending",
      }),
    ]);

    mocks.eventSubscriber?.({ type: "agent_end", messages: [] });
    await vi.waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(3));
    expect(mocks.prompt.mock.calls[2]).toEqual([
      "Second follow-up",
      undefined,
      { clientMessageId: "queued-second" },
    ]);
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    await registry.stopAll();
  });

  it("restores a queued message when steering rejects it", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await runtime.command(
      { type: "prompt", message: "Start the task" },
      "initial-message",
    );
    await runtime.command(
      { type: "queue", message: "Try this approach" },
      "queued-message",
    );
    mocks.steer.mockRejectedValueOnce(new Error("Provider rejected steer"));

    await expect(
      runtime.command({
        type: "steer_queued_message",
        id: "queued-message",
      }),
    ).rejects.toThrow("Provider rejected steer");
    expect(runtime.snapshot().queuedMessages).toEqual([
      expect.objectContaining({
        id: "queued-message",
        status: "pending",
      }),
    ]);
    expect(
      runtime
        .snapshot()
        .messages.some(
          (message) =>
            message &&
            typeof message === "object" &&
            Reflect.get(message, "overtchatSubmissionId") ===
              "queued-message",
        ),
    ).toBe(false);
    await registry.stopAll();
  });

  it("stops the active turn without starting a replacement prompt", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await runtime.command(
      { type: "prompt", message: "Start the task" },
      "initial-message",
    );
    await runtime.command({ type: "abort" });

    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(runtime.snapshot().status).toBe("idle");
    await registry.stopAll();
  });

  it.each(["pi", "omp"] as const)(
    "uses the shared durable queue and steering path for %s",
    async (provider) => {
      const registry = new AgentRuntimeRegistry({
        resolveImages: async () => [],
      });
      const runtime = await registry.getOrStart({
        connectionId: "connection",
        workspaceId: "workspace",
        provider,
        target: { transport: "local" },
        executable: provider,
        cwd: "/workspace",
        sessionId: `session-${provider}`,
        providerSessionId: "provider-session",
        providerSessionPath: "/sessions/provider-session.jsonl",
      });

      await runtime.command(
        { type: "prompt", message: "Start the task" },
        `initial-${provider}`,
      );
      await runtime.command(
        { type: "queue", message: "Replace the approach" },
        `queued-${provider}`,
      );
      await runtime.command({
        type: "steer_queued_message",
        id: `queued-${provider}`,
      });

      expect(mocks.steer).toHaveBeenCalledWith(
        "Replace the approach",
        undefined,
        { clientMessageId: `queued-${provider}` },
      );
      expect(runtime.snapshot().provider).toBe(provider);
      expect(runtime.snapshot().queuedMessages).toEqual([]);
      await registry.stopAll();
    },
  );

  it("publishes one canonical user message when a provider echoes before accepting", async () => {
    mocks.prompt.mockImplementation(async () => {
      mocks.eventSubscriber?.({
        type: "message_start",
        message: {
          id: "provider-message",
          role: "user",
          content: "Continue the task",
          timestamp: 123,
        },
      });
      return { accepted: true };
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await runtime.command(
      { type: "prompt", message: "Continue the task" },
      "client-message",
    );

    expect(runtime.snapshot().messages).toEqual([
      {
        id: "provider-message",
        role: "user",
        content: "Continue the task",
        timestamp: 123,
      },
    ]);
    await registry.stopAll();
  });

  it("keeps an acknowledged prompt when the transport rejects afterward", async () => {
    mocks.prompt.mockImplementation(async (_message, _images, options) => {
      mocks.eventSubscriber?.({
        type: "message_start",
        message: {
          id: "provider-message",
          role: "user",
          content: "Continue the task",
          timestamp: 123,
          overtchatSubmissionId: options?.clientMessageId,
        },
      });
      throw new Error("Transport closed after provider acceptance");
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await expect(
      runtime.command(
        { type: "prompt", message: "Continue the task" },
        "client-message",
      ),
    ).resolves.toEqual({ accepted: true, providerAcknowledged: true });
    expect(runtime.snapshot().messages).toEqual([
      expect.objectContaining({
        id: "provider-message",
        content: "Continue the task",
        overtchatSubmissionId: "client-message",
      }),
    ]);
    expect(runtime.snapshot().error).toBeUndefined();
    await registry.stopAll();
  });

  it("removes the canonical user message when the provider rejects it", async () => {
    mocks.prompt.mockRejectedValue(new Error("Provider rejected the prompt"));
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await expect(
      runtime.command(
        { type: "prompt", message: "Continue the task" },
        "client-message",
      ),
    ).rejects.toThrow("Provider rejected the prompt");
    expect(runtime.snapshot().messages).toEqual([]);
    await registry.stopAll();
  });

  it("reconciles a native steering echo with the canonical steer message", async () => {
    mocks.prompt.mockImplementation(async () => {
      mocks.eventSubscriber?.({
        type: "message_start",
        message: {
          id: "provider-prompt",
          role: "user",
          content: "Start the task",
          timestamp: 123,
        },
      });
      return { accepted: true };
    });
    mocks.steer.mockImplementation(async () => {
      mocks.eventSubscriber?.({
        type: "message_start",
        message: {
          id: "provider-steer",
          role: "user",
          content: "Use the other approach",
          timestamp: 124,
        },
      });
      return { accepted: true };
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await runtime.command(
      { type: "prompt", message: "Start the task" },
      "client-prompt",
    );
    await runtime.command(
      { type: "queue", message: "Use the other approach" },
      "client-steer",
    );
    await runtime.command({
      type: "steer_queued_message",
      id: "client-steer",
    });

    expect(runtime.snapshot().messages).toEqual([
      expect.objectContaining({
        id: "provider-prompt",
        content: "Start the task",
      }),
      expect.objectContaining({
        id: "provider-steer",
        content: "Use the other approach",
      }),
    ]);
    await registry.stopAll();
  });

  it("keeps the connector snapshot in canonical turn order after a steer race", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await runtime.command(
      { type: "prompt", message: "write a paragraph on overtchat" },
      "client-prompt",
    );
    await runtime.command(
      { type: "queue", message: "2 more now" },
      "client-steer",
    );
    await runtime.command({
      type: "steer_queued_message",
      id: "client-steer",
    });
    mocks.eventSubscriber?.({
      type: "overtchat_turn_update",
      turnId: "turn-1",
      messages: [
        {
          id: "turn-1:user:0",
          role: "user",
          content: "write a paragraph on overtchat",
          overtchatSubmissionId: "client-prompt",
          overtchatTurnId: "turn-1",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: [{ type: "text", text: "First paragraph" }],
          overtchatTurnId: "turn-1",
        },
        {
          id: "turn-1:user:1",
          role: "user",
          content: "2 more now",
          overtchatSubmissionId: "client-steer",
          overtchatTurnId: "turn-1",
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: [{ type: "text", text: "Two more paragraphs" }],
          overtchatTurnId: "turn-1",
        },
        {
          id: "turn-1:footer",
          role: "turnFooter",
          content: "First paragraph\n\nTwo more paragraphs",
          overtchatTurnId: "turn-1",
        },
      ],
    });

    expect(
      runtime.snapshot().messages.map((message) =>
        message && typeof message === "object"
          ? [Reflect.get(message, "role"), Reflect.get(message, "id")]
          : null,
      ),
    ).toEqual([
      ["user", "turn-1:user:0"],
      ["assistant", "assistant-1"],
      ["user", "turn-1:user:1"],
      ["assistant", "assistant-2"],
      ["turnFooter", "turn-1:footer"],
    ]);
    await registry.stopAll();
  });

  it("keeps an acknowledged steer when the transport rejects afterward", async () => {
    mocks.steer.mockImplementation(async (_message, _images, options) => {
      mocks.eventSubscriber?.({
        type: "overtchat_turn_update",
        turnId: "turn-1",
        messages: [
          {
            id: "provider-steer",
            role: "user",
            content: "Use the other approach",
            timestamp: 124,
            overtchatSubmissionId: options?.clientMessageId,
            overtchatTurnId: "turn-1",
          },
        ],
      });
      throw new Error("Transport closed after provider acceptance");
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    const runtime = await registry.getOrStart({
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

    await runtime.command(
      { type: "prompt", message: "Start the task" },
      "client-prompt",
    );
    await expect(
      runtime
        .command(
          { type: "queue", message: "Use the other approach" },
          "client-steer",
        )
        .then(() =>
          runtime.command({
            type: "steer_queued_message",
            id: "client-steer",
          }),
        ),
    ).resolves.toEqual({ accepted: true, providerAcknowledged: true });
    expect(runtime.snapshot().messages).toEqual([
      expect.objectContaining({ content: "Start the task" }),
      expect.objectContaining({
        id: "provider-steer",
        content: "Use the other approach",
        overtchatSubmissionId: "client-steer",
      }),
    ]);
    expect(runtime.snapshot().error).toBeUndefined();
    await registry.stopAll();
  });
});
