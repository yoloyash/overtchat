import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderId } from "@overtchat/agent-bridge";
import type { AgentRuntimeEvent } from "@overtchat/agent-runtime/providers/types";

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  steer: vi.fn(),
  abort: vi.fn(),
  forkSession: vi.fn(),
  stop: vi.fn(),
  saveQueue: vi.fn(),
  getState: vi.fn(),
  getMessages: vi.fn(),
  getAvailableModels: vi.fn(),
  setModel: vi.fn(),
  setThinkingLevel: vi.fn(),
  setMode: vi.fn(),
  fetchCatalog: vi.fn(),
  launches: [] as Array<Record<string, unknown>>,
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
    fetchCatalog: mocks.fetchCatalog,
    startSession: (_target: unknown, launch: Record<string, unknown>) => {
      mocks.launches.push(launch);
      return {
      onEvent: vi.fn((subscriber: (event: AgentRuntimeEvent) => void) => {
        mocks.eventSubscriber = subscriber;
        return vi.fn();
      }),
      getState: mocks.getState,
      getMessages: mocks.getMessages,
      getAvailableModels: mocks.getAvailableModels,
      getSessionStats: vi.fn().mockResolvedValue(stats),
      getCommands: vi.fn().mockResolvedValue([]),
      prompt: mocks.prompt,
      steer: mocks.steer,
      abort: mocks.abort,
      setModel: mocks.setModel,
      setThinkingLevel: mocks.setThinkingLevel,
      setMode: mocks.setMode,
      forkSession: mocks.forkSession,
      stop: mocks.stop,
      };
    },
    sessionIdentity: () => ({
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      sessionName: null,
    }),
    createEventClassifier: () => ({
      classify: (event: AgentRuntimeEvent) => ({
        started:
          event.type === "agent_start" || event.type === "compaction_start",
        terminal:
          event.type === "agent_end" || event.type === "compaction_end",
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
    mocks.setModel.mockResolvedValue(undefined);
    mocks.setThinkingLevel.mockResolvedValue(undefined);
    mocks.setMode.mockResolvedValue(undefined);
    mocks.fetchCatalog.mockResolvedValue({
      provider: "codex",
      models: [
        {
          provider: "codex",
          id: "default-model",
          label: "Default model",
          isDefault: true,
          api: "",
          baseUrl: "",
          reasoning: true,
          input: ["text"],
          contextWindow: null,
          maxTokens: null,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High", isDefault: true },
          ],
          defaultThinkingOptionId: "high",
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      modes: [{ id: "auto", label: "Auto", description: "Configured" }],
      defaultModeId: "auto",
    });
    mocks.launches.length = 0;
    mocks.forkSession.mockResolvedValue({
      session: {
        providerSessionId: "forked-provider-session",
        providerSessionPath: "/sessions/forked-provider-session.jsonl",
        name: null,
        firstMessage: null,
        messageCount: 0,
        createdAt: null,
        modifiedAt: null,
      },
    });
    mocks.stop.mockResolvedValue(undefined);
    mocks.saveQueue.mockResolvedValue(undefined);
    mocks.getState.mockResolvedValue({
      isStreaming: false,
      sessionId: "provider-session",
      sessionFile: "/sessions/provider-session.jsonl",
    });
    mocks.getMessages.mockResolvedValue({ messages: [] });
    mocks.getAvailableModels.mockResolvedValue([
      { provider: "openai", id: "gpt-5", name: "GPT-5", input: ["text"] },
    ]);
    mocks.eventSubscriber = null;
  });

  it("refreshes the existing runtime after adopting an edited provider session", async () => {
    mocks.getState
      .mockResolvedValueOnce({
        isStreaming: false,
        sessionId: "provider-session",
        sessionFile: "/sessions/provider-session.jsonl",
      })
      .mockResolvedValueOnce({
        isStreaming: false,
        sessionId: "edited-provider-session",
        sessionFile: "/sessions/edited-provider-session.jsonl",
      });
    mocks.getMessages
      .mockResolvedValueOnce({
        messages: [{ id: "source-user", role: "user", content: "Original" }],
      })
      .mockResolvedValueOnce({ messages: [] });
    mocks.forkSession.mockResolvedValueOnce({
      session: {
        providerSessionId: "edited-provider-session",
        providerSessionPath: "/sessions/edited-provider-session.jsonl",
        name: null,
        firstMessage: null,
        messageCount: 0,
        createdAt: null,
        modifiedAt: null,
      },
      draft: "Original",
      replacesCurrentSession: true,
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      saveQueuedMessages: mocks.saveQueue,
    });
    const runtime = await registry.getOrStart({
      sessionId: "session",
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "codex",
      target: { transport: "local" },
      executable: "codex",
      cwd: "/workspace",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
    });

    await expect(
      registry.fork(runtime, {
        type: "edit_message",
        messageId: "source-user",
      }),
    ).resolves.toMatchObject({
      replacesCurrentSession: true,
      draft: "Original",
    });

    expect(runtime.snapshot()).toMatchObject({
      sessionId: "session",
      state: {
        sessionId: "edited-provider-session",
        sessionFile: "/sessions/edited-provider-session.jsonl",
      },
      messages: [],
    });
  });

  it("removes a restored send already accepted by the provider", async () => {
    mocks.getMessages.mockResolvedValueOnce({
      messages: [
        {
          role: "user",
          content: "Continue the task",
          overtchatSubmissionId: "message-1",
        },
      ],
    });
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
      launchConfig: {},
    });

    await vi.waitFor(() => {
      expect(mocks.saveQueue).toHaveBeenCalledWith("session", []);
    });
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    await registry.stopAll();
  });

  it("marks an unconfirmed restored send as delivery-uncertain", async () => {
    mocks.getState.mockResolvedValueOnce({
      isStreaming: true,
      sessionId: "provider-session",
      sessionFile: "/sessions/provider-session.jsonl",
    });
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
      launchConfig: {},
    });

    await Promise.resolve();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.saveQueue).toHaveBeenCalledWith("session", [
      expect.objectContaining({ id: "message-1", status: "uncertain" }),
    ]);
    expect(runtime.snapshot().queuedMessages).toEqual([
      expect.objectContaining({ id: "message-1", status: "uncertain" }),
    ]);
    await registry.stopAll();
  });

  it("reconciles an in-flight restored send from provider history before draining", async () => {
    mocks.getState
      .mockResolvedValueOnce({
        isStreaming: true,
        sessionId: "provider-session",
        sessionFile: "/sessions/provider-session.jsonl",
      })
      .mockResolvedValue({
        isStreaming: false,
        sessionId: "provider-session",
        sessionFile: "/sessions/provider-session.jsonl",
      });
    mocks.getMessages
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValue({
        messages: [
          {
            role: "user",
            content: "Continue the task",
            overtchatSubmissionId: "message-1",
          },
        ],
      });
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
      launchConfig: {},
    });

    mocks.eventSubscriber?.({ type: "agent_end", messages: [] });
    await vi.waitFor(() => {
      expect(runtime.snapshot().queuedMessages).toEqual([]);
    });
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.saveQueue).toHaveBeenCalledWith("session", []);
    await registry.stopAll();
  });

  it("does not infer acceptance or replay from matching text alone", async () => {
    mocks.getMessages.mockResolvedValueOnce({
      messages: [{ role: "user", content: "Continue the task" }],
    });
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
      launchConfig: {},
    });

    await Promise.resolve();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.saveQueue).toHaveBeenCalledWith("session", [
      expect.objectContaining({ id: "message-1", status: "uncertain" }),
    ]);
    expect(runtime.snapshot().queuedMessages).toEqual([
      expect.objectContaining({ id: "message-1", status: "uncertain" }),
    ]);
    await registry.stopAll();
  });

  it("keeps a repeated identical restored send uncertain and blocks later queue items", async () => {
    mocks.getMessages.mockResolvedValueOnce({
      messages: [{ role: "user", content: "Repeat this" }],
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "message-2",
          message: "Repeat this",
          status: "sending",
        },
        {
          id: "message-3",
          message: "This must remain behind the ambiguous send",
          status: "pending",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
    });

    const runtime = await registry.getOrStart({
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "pi",
      target: { transport: "local" },
      executable: "pi",
      cwd: "/workspace",
      sessionId: "session",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
    });

    await Promise.resolve();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.saveQueue).toHaveBeenCalledWith(
      "session",
      expect.arrayContaining([
        expect.objectContaining({ id: "message-2", status: "uncertain" }),
      ]),
    );
    expect(runtime.snapshot().queuedMessages).toEqual([
      expect.objectContaining({
        id: "message-2",
        status: "uncertain",
      }),
      expect.objectContaining({ id: "message-3", status: "pending" }),
    ]);
    await registry.stopAll();
  });

  it("lets users remove an uncertain restored send without replaying it", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "message-1",
          message: "Continue the task",
          status: "uncertain",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
    });
    const runtime = await registry.getOrStart({
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "pi",
      target: { transport: "local" },
      executable: "pi",
      cwd: "/workspace",
      sessionId: "session",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
    });

    await runtime.command({
      type: "remove_queued_message",
      id: "message-1",
    });

    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    expect(mocks.saveQueue).toHaveBeenLastCalledWith("session", []);
    await registry.stopAll();
  });

  it("clears an uncertain send when a later provider event proves its identity", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "message-1",
          message: "Continue the task",
          status: "uncertain",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
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
      launchConfig: {},
    });

    mocks.eventSubscriber?.({
      type: "message_start",
      message: {
        role: "user",
        content: "Continue the task",
        overtchatSubmissionId: "message-1",
      },
    });

    await vi.waitFor(() => {
      expect(runtime.snapshot().queuedMessages).toEqual([]);
    });
    expect(mocks.saveQueue).toHaveBeenLastCalledWith("session", []);
    expect(mocks.prompt).not.toHaveBeenCalled();
    await registry.stopAll();
  });

  it("does not infer delivery from later identical provider history", async () => {
    mocks.getMessages.mockResolvedValueOnce({
      messages: [
        { role: "user", content: "Repeat this" },
        { role: "user", content: "Repeat this" },
      ],
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "message-2",
          message: "Repeat this",
          status: "sending",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
    });

    const runtime = await registry.getOrStart({
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "omp",
      target: { transport: "local" },
      executable: "omp",
      cwd: "/workspace",
      sessionId: "session",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
    });

    await vi.waitFor(() => {
      expect(mocks.saveQueue).toHaveBeenCalledWith("session", [
        expect.objectContaining({ id: "message-2", status: "uncertain" }),
      ]);
    });
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(runtime.snapshot().queuedMessages).toEqual([
      expect.objectContaining({ id: "message-2", status: "uncertain" }),
    ]);
    await registry.stopAll();
  });

  it("does not infer image-only acceptance from arbitrary history advancement", async () => {
    mocks.getMessages.mockResolvedValueOnce({
      messages: [{ role: "user", content: "An unrelated prompt" }],
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "image-message",
          message: "",
          images: [
            {
              uploadId: "11111111-1111-4111-8111-111111111111",
              filename: "screen.png",
              mediaType: "image/png",
            },
          ],
          status: "sending",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
    });

    const runtime = await registry.getOrStart({
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "pi",
      target: { transport: "local" },
      executable: "pi",
      cwd: "/workspace",
      sessionId: "session",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
    });

    await vi.waitFor(() => {
      expect(runtime.snapshot().queuedMessages).toEqual([
        expect.objectContaining({
          id: "image-message",
          status: "uncertain",
        }),
      ]);
    });
    expect(mocks.prompt).not.toHaveBeenCalled();
    await registry.stopAll();
  });

  it("persists the sending state before invoking the provider", async () => {
    let releaseSave: (() => void) | undefined;
    mocks.saveQueue.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "message-1",
          message: "Continue the task",
          status: "pending",
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
      launchConfig: {},
    });

    await vi.waitFor(() => expect(mocks.saveQueue).toHaveBeenCalledOnce());
    expect(mocks.saveQueue).toHaveBeenCalledWith("session", [
      expect.objectContaining({
        id: "message-1",
        status: "sending",
      }),
    ]);
    expect(mocks.prompt).not.toHaveBeenCalled();
    releaseSave?.();
    await vi.waitFor(() => expect(mocks.prompt).toHaveBeenCalledOnce());
    await registry.stopAll();
  });

  it("surfaces queue persistence failure without invoking the provider", async () => {
    mocks.saveQueue.mockRejectedValueOnce(new Error("disk full"));
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      saveQueuedMessages: mocks.saveQueue,
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
      launchConfig: {},
    });

    await expect(
      runtime.command(
        { type: "queue", message: "Continue the task" },
        "message-1",
      ),
    ).rejects.toThrow("disk full");
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(runtime.snapshot().error).toBe(
      "Unable to persist queued messages: disk full",
    );
    expect(runtime.snapshot().queuedMessages).toEqual([]);
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
      launchConfig: {},
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

  it("holds queued prompts until compaction finishes", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      saveQueuedMessages: mocks.saveQueue,
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
      launchConfig: {},
    });

    mocks.eventSubscriber?.({ type: "compaction_start" });
    await runtime.command(
      { type: "queue", message: "Continue after compaction" },
      "after-compaction",
    );

    expect(runtime.snapshot()).toMatchObject({
      status: "running",
      state: { isCompacting: true },
      queuedMessages: [
        {
          id: "after-compaction",
          message: "Continue after compaction",
          status: "pending",
        },
      ],
    });
    expect(mocks.prompt).not.toHaveBeenCalled();

    mocks.eventSubscriber?.({ type: "compaction_end" });
    await vi.waitFor(() => {
      expect(mocks.prompt).toHaveBeenCalledWith(
        "Continue after compaction",
        undefined,
        { clientMessageId: "after-compaction" },
      );
    });
    await vi.waitFor(() => {
      expect(runtime.snapshot().queuedMessages).toEqual([]);
    });
    await registry.stopAll();
  });

  it("marks a queued prompt uncertain when the provider call rejects", async () => {
    mocks.prompt.mockRejectedValueOnce(new Error("transport disconnected"));
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      loadQueuedMessages: () => [
        {
          id: "queued-message",
          message: "Continue the task",
          status: "pending",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
    });
    const runtime = await registry.getOrStart({
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "pi",
      target: { transport: "local" },
      executable: "pi",
      cwd: "/workspace",
      sessionId: "session",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
    });

    await vi.waitFor(() => expect(mocks.prompt).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(runtime.snapshot().queuedMessages).toEqual([
        expect.objectContaining({
          id: "queued-message",
          status: "uncertain",
        }),
      ]);
    });
    await Promise.resolve();
    expect(mocks.prompt).toHaveBeenCalledOnce();

    await runtime.command({
      type: "remove_queued_message",
      id: "queued-message",
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);
    await registry.stopAll();
  });

  it.each([
    "an identical user message without a submission ID",
    "a terminal event without a submission ID",
  ])(
    "keeps a queued prompt uncertain when %s precedes a transport rejection",
    async (eventKind) => {
      mocks.prompt.mockImplementationOnce(async () => {
        if (eventKind.startsWith("an identical")) {
          mocks.eventSubscriber?.({
            type: "message_start",
            message: {
              id: "provider-message",
              role: "user",
              content: "Continue the task",
            },
          });
        } else {
          mocks.eventSubscriber?.({ type: "agent_end", messages: [] });
        }
        throw new Error("transport disconnected after ambiguous provider event");
      });
      const registry = new AgentRuntimeRegistry({
        resolveImages: async () => [],
        loadQueuedMessages: () => [
          {
            id: "queued-message",
            message: "Continue the task",
            status: "pending",
          },
        ],
        saveQueuedMessages: mocks.saveQueue,
      });
      const runtime = await registry.getOrStart({
        connectionId: "connection",
        workspaceId: "workspace",
        provider: "pi",
        target: { transport: "local" },
        executable: "pi",
        cwd: "/workspace",
        sessionId: "session",
        providerSessionId: "provider-session",
        providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
      });

      await vi.waitFor(() => {
        expect(runtime.snapshot().queuedMessages).toEqual([
          expect.objectContaining({
            id: "queued-message",
            status: "uncertain",
          }),
        ]);
      });
      expect(mocks.prompt).toHaveBeenCalledOnce();
      expect(mocks.saveQueue).not.toHaveBeenCalledWith("session", []);

      mocks.eventSubscriber?.({ type: "agent_end", messages: [] });
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
      expect(mocks.prompt).toHaveBeenCalledOnce();
      expect(runtime.snapshot().queuedMessages).toEqual([
        expect.objectContaining({
          id: "queued-message",
          status: "uncertain",
        }),
      ]);
      expect(mocks.saveQueue).not.toHaveBeenCalledWith("session", []);
      await registry.stopAll();
    },
  );

  it("keeps a queued prompt pending when preparation fails before provider invocation", async () => {
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => {
        throw new Error("attachment disappeared");
      },
      loadQueuedMessages: () => [
        {
          id: "queued-message",
          message: "",
          images: [
            {
              uploadId: "11111111-1111-4111-8111-111111111111",
              filename: "screen.png",
              mediaType: "image/png",
            },
          ],
          status: "pending",
        },
      ],
      saveQueuedMessages: mocks.saveQueue,
    });
    const runtime = await registry.getOrStart({
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "pi",
      target: { transport: "local" },
      executable: "pi",
      cwd: "/workspace",
      sessionId: "session",
      providerSessionId: "provider-session",
      providerSessionPath: "/sessions/provider-session.jsonl",
      launchConfig: {},
    });

    await vi.waitFor(() => {
      expect(mocks.saveQueue).toHaveBeenLastCalledWith("session", [
        expect.objectContaining({
          id: "queued-message",
          status: "pending",
        }),
      ]);
    });
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(runtime.snapshot().queuedMessages).toEqual([
      expect.objectContaining({ id: "queued-message", status: "pending" }),
    ]);
    await registry.stopAll();
  });

  it("marks a queued steer uncertain when the provider call rejects", async () => {
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
      launchConfig: {},
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
        status: "uncertain",
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
    await runtime.command({
      type: "remove_queued_message",
      id: "queued-message",
    });
    expect(runtime.snapshot().queuedMessages).toEqual([]);
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
      launchConfig: {},
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
      launchConfig: {},
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
      launchConfig: {},
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
        timestamp: expect.any(Number),
        overtchatProviderTimestamp: 123,
        overtchatSubmissionId: "client-message",
      },
    ]);
    await registry.stopAll();
  });

  it("keeps submitted image presentation through provider history refresh", async () => {
    mocks.getState.mockResolvedValue({
      isStreaming: false,
      sessionId: "provider-session",
      sessionFile: "/sessions/provider-session.jsonl",
      model: { provider: "codex", id: "gpt-5" },
    });
    mocks.getAvailableModels.mockResolvedValue([
      {
        provider: "codex",
        id: "gpt-5",
        name: "GPT-5",
        input: ["text", "image"],
      },
    ]);
    mocks.getMessages
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({
        messages: [
          {
            id: "provider-message",
            role: "user",
            content: [
              { type: "text", text: "Inspect this" },
              { data: "aW1hZ2U=", mimeType: "image/png" },
            ],
            timestamp: 200,
          },
        ],
      });
    mocks.prompt.mockImplementation(async (_message, _images, options) => {
      mocks.eventSubscriber?.({
        type: "message_start",
        message: {
          id: "provider-message",
          role: "user",
          content: [
            { type: "text", text: "Inspect this" },
            { data: "aW1hZ2U=", mimeType: "image/png" },
          ],
          timestamp: 200,
          overtchatSubmissionId: options?.clientMessageId,
        },
      });
      return { accepted: true };
    });
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          filename: "screen.png",
          mediaType: "image/png",
          data: "aW1hZ2U=",
        },
      ],
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
      launchConfig: {},
    });

    await runtime.command(
      {
        type: "prompt",
        message: "Inspect this",
        images: [
          {
            uploadId: "11111111-1111-4111-8111-111111111111",
            filename: "screen.png",
            mediaType: "image/png",
          },
        ],
      },
      "client-message",
    );
    const submitted = runtime.snapshot().messages[0] as Record<string, unknown>;

    mocks.eventSubscriber?.({ type: "agent_end", messages: [] });
    await vi.waitFor(() => expect(mocks.getMessages).toHaveBeenCalledTimes(2));

    expect(runtime.snapshot().messages).toEqual([
      {
        id: "provider-message",
        role: "user",
        content: submitted.content,
        timestamp: submitted.timestamp,
        overtchatProviderTimestamp: 200,
        overtchatSubmissionId: "client-message",
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
      launchConfig: {},
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
      launchConfig: {},
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
    mocks.prompt.mockImplementation(async (_message, _images, options) => {
      mocks.eventSubscriber?.({
        type: "message_start",
        message: {
          id: "provider-prompt",
          role: "user",
          content: "Start the task",
          timestamp: 123,
          overtchatSubmissionId: options?.clientMessageId,
        },
      });
      return { accepted: true };
    });
    mocks.steer.mockImplementation(async (_message, _images, options) => {
      mocks.eventSubscriber?.({
        type: "message_start",
        message: {
          id: "provider-steer",
          role: "user",
          content: "Use the other approach",
          timestamp: 124,
          overtchatSubmissionId: options?.clientMessageId,
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
      launchConfig: {},
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
      launchConfig: {},
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
      launchConfig: {},
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

  it("does not consume a private sequence when another subscriber joins", async () => {
    const registry = new AgentRuntimeRegistry({ resolveImages: async () => [] });
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
      launchConfig: {},
    });
    const first: number[] = [];
    const second: number[] = [];
    const unsubscribeFirst = runtime.subscribe((event) => {
      first.push(event.sequence);
    });
    mocks.eventSubscriber?.({
      type: "overtchat_status",
      status: "running",
      startedAt: 1,
    });
    const unsubscribeSecond = runtime.subscribe((event) => {
      second.push(event.sequence);
    });
    mocks.eventSubscriber?.({
      type: "overtchat_status",
      status: "idle",
      startedAt: null,
    });

    expect(first).toEqual([1, 2]);
    expect(second).toEqual([1, 2]);
    unsubscribeFirst();
    unsubscribeSecond();
    await registry.stopAll();
  });

  it("stamps provider events once before updating state and publishing", async () => {
    const registry = new AgentRuntimeRegistry({ resolveImages: async () => [] });
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
      launchConfig: {},
    });
    const observed: Array<Record<string, unknown>> = [];
    runtime.observe((envelope) => {
      if (envelope.type === "runtime_event") observed.push(envelope.data);
    });
    const providerEvent: AgentRuntimeEvent = {
      type: "command_output",
      text: "Current model: GPT-5.6",
    };

    mocks.eventSubscriber?.(providerEvent);

    const recordedAt = observed[0]?.overtchatRecordedAt;
    expect(recordedAt).toEqual(expect.any(Number));
    expect(runtime.snapshot().messages).toEqual([
      expect.objectContaining({
        role: "custom",
        content: "Current model: GPT-5.6",
        timestamp: recordedAt,
      }),
    ]);
    expect(providerEvent).not.toHaveProperty("overtchatRecordedAt");
    await registry.stopAll();
  });

  it("resets synchronization when the cursor is from another epoch or ahead", async () => {
    const registry = new AgentRuntimeRegistry({ resolveImages: async () => [] });
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
      launchConfig: {},
    });
    mocks.eventSubscriber?.({
      type: "overtchat_status",
      status: "running",
      startedAt: 1,
    });
    const current = runtime.sync();
    expect(current.reset).toBe(true);
    expect(runtime.sync({ epoch: "old", sequence: 0 }).reset).toBe(true);
    expect(
      runtime.sync({
        epoch: current.cursor.epoch,
        sequence: current.cursor.sequence + 1,
      }).reset,
    ).toBe(true);
    expect(runtime.sync(current.cursor)).toEqual({
      reset: false,
      cursor: current.cursor,
      events: [],
    });
    await registry.stopAll();
  });

  it("resolves provider defaults into an explicit launch tuple", async () => {
    const registry = new AgentRuntimeRegistry({ resolveImages: async () => [] });
    const created = await registry.create("session", {
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "codex",
      target: { transport: "local" },
      executable: "codex",
      cwd: "/workspace",
    });

    expect(created.launchConfig).toEqual({
      model: "default-model",
      thinkingOptionId: "high",
      modeId: "auto",
    });
    expect(mocks.launches).toContainEqual(
      expect.objectContaining(created.launchConfig),
    );
    await registry.stopAll();
  });

  it("persists live model, thinking, and mode selections into resume metadata", async () => {
    const updateSessionMetadata = vi.fn();
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
      updateSessionMetadata,
    });
    const { runtime } = await registry.create("session", {
      connectionId: "connection",
      workspaceId: "workspace",
      provider: "codex",
      target: { transport: "local" },
      executable: "codex",
      cwd: "/workspace",
    });

    await runtime.command({ type: "set_model", modelId: "other/model" });
    await runtime.command({ type: "set_thinking_level", level: "low" });
    await runtime.command({ type: "set_mode", modeId: "manual" });

    expect(updateSessionMetadata).toHaveBeenLastCalledWith("session", {
      launchConfig: {
        model: "other/model",
        thinkingOptionId: "low",
        modeId: "manual",
      },
    });
    await registry.stopAll();
  });
});
