import { describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>(), query: queryMock,
}));

import { rm, unlink } from "node:fs/promises";
import { claudeRewindFixture } from "./rewind.test-helper";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";
import { ClaudeRuntimeClient } from "./client";
import { claudeProviderAdapter } from "../providers/claude";
import { AgentSessionRuntime } from "../runtime/registry";
import { applyAgentRuntimeEnvelope, type AgentRuntimeEnvelope } from "@overtchat/agent-bridge";

class FakeQuery implements AsyncIterator<unknown> {
  readonly inputs: AsyncIterable<unknown>;
  readonly options: Record<string, unknown>;
  readonly setModel = vi.fn(async () => {});
  readonly setPermissionMode = vi.fn(async () => {});
  readonly getContextUsage = vi.fn()
    .mockResolvedValueOnce({ totalTokens: 0, maxTokens: 200_000 })
    .mockRejectedValue(new Error("Context control unavailable"));
  readonly interrupt = vi.fn(async () => ({ still_queued: [] }));
  readonly rewindFiles = vi.fn(async () => ({ canRewind: true }));
  private readonly values: unknown[] = [];
  private readonly waiters: Array<(value: IteratorResult<unknown>) => void> = [];
  private closed = false;

  constructor(params: {
    prompt: AsyncIterable<unknown>;
    options: Record<string, unknown>;
  }) {
    this.inputs = params.prompt;
    this.options = params.options;
  }

  initializationResult() {
    return Promise.resolve({
      commands: [
        { name: "review", description: "Review changes", argumentHint: "" },
      ],
      agents: [],
      output_style: "default",
      available_output_styles: [],
      account: { apiProvider: "firstParty" },
      models: [
        {
          value: "haiku",
          displayName: "Haiku",
          description: "Fast",
          supportsAutoMode: true,
        },
      ],
    });
  }

  push(value: unknown): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  next(): Promise<IteratorResult<unknown>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this;
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function createClientForTest() {
  let query!: FakeQuery;
  queryMock.mockImplementation((params) => {
    query = new FakeQuery(params);
    return query;
  });
  const client = new ClaudeRuntimeClient(
    { transport: "local" },
    { executable: "claude", cwd: "/workspace", modeId: "default" },
  );
  await client.getState();
  const events: Array<Record<string, unknown>> = [];
  client.onEvent((event) => events.push(event));
  return { client, query, events };
}

async function createRuntimeForTest() {
  const harness = await createClientForTest();
  const { client } = harness;
  const runtime = new AgentSessionRuntime(
    "session", "connection", "workspace", claudeProviderAdapter, client,
    {
      state: await client.getState(), messages: [],
      models: await client.getAvailableModels(), commands: await client.getCommands(),
      stats: await client.getSessionStats(),
    },
    {}, async () => [], vi.fn(), vi.fn(), [], vi.fn(),
  );
  const envelopes: AgentRuntimeEnvelope[] = [];
  let replica = runtime.snapshot();
  runtime.observe((event) => {
    envelopes.push(event);
    replica = applyAgentRuntimeEnvelope(replica, event)!;
  });
  return { ...harness, runtime, envelopes, replica: () => replica };
}

function backgroundTasks(...ids: string[]) {
  return {
    type: "system", subtype: "background_tasks_changed",
    tasks: ids.map((task_id) => ({ task_id, task_type: "local_agent", description: "Research" })),
  };
}

const successfulResult = { type: "result", subtype: "success", is_error: false, usage: {} };

describe("Claude parent turns and background work", () => {
  it("keeps the runtime and replica busy after the parent yields, then resumes on native init", async () => {
    const { client, query, runtime, replica, envelopes, events } = await createRuntimeForTest();
    try {
      await runtime.command({ type: "prompt", message: "Research" });
      query.push(backgroundTasks("first", "second"));
      query.push(successfulResult);
      await nextTask();
      expect(await client.getState()).toMatchObject({ isStreaming: false, hasPendingAsyncWork: true });
      const waiting = { status: "running", activeTurn: { phase: "waiting" } };
      expect(runtime.snapshot()).toMatchObject(waiting);
      expect(replica()).toMatchObject(waiting);
      expect(envelopes).toContainEqual(expect.objectContaining({
        type: "runtime_event", data: expect.objectContaining({ type: "overtchat_status", status: "running", phase: "waiting" }),
      }));
      await runtime.refreshState();
      expect(runtime.snapshot()).toMatchObject(waiting);

      // Child output and CLI-wide running do not mean the parent is responding.
      query.push({ type: "assistant", parent_tool_use_id: "child", message: { id: "child-message", content: [{ type: "text", text: "Researching" }] } });
      query.push({ type: "system", subtype: "session_state_changed", state: "running" });
      query.push(backgroundTasks("second"));
      await nextTask();
      expect(runtime.snapshot()).toMatchObject(waiting);

      query.push({ type: "system", subtype: "init", session_id: "native-session" });
      await nextTask();
      expect(runtime.snapshot()).toMatchObject({ status: "running", activeTurn: { phase: "responding" } });
      expect(replica()).toMatchObject({ status: "running", activeTurn: { phase: "responding" } });
      expect(events.filter((event) => event.type === "turn_start")).toHaveLength(2);

      // Completing the last child cannot terminate a parent that is still answering.
      query.push(backgroundTasks());
      await nextTask();
      expect(runtime.snapshot().status).toBe("running");
      query.push(successfulResult);
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
      expect(replica()).toMatchObject({ status: "idle", activeTurn: null });
    } finally { await runtime.stop(); }
  });

  it("recognizes an autonomous wake after the last task disappears before its notification", async () => {
    const { query, runtime, events, replica } = await createRuntimeForTest();
    try {
      await runtime.command({ type: "prompt", message: "Start background work" });
      query.push(backgroundTasks("child"));
      query.push(successfulResult);
      await nextTask();
      query.push(backgroundTasks());
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
      query.push({ type: "system", subtype: "task_notification", task_id: "child", status: "completed" });
      query.push({ type: "system", subtype: "init", session_id: "native-session" });
      query.push({ type: "assistant", parent_tool_use_id: null, message: { id: "wake", content: [{ type: "text", text: "The background task finished" }] } });
      await nextTask();
      expect(runtime.snapshot()).toMatchObject({ status: "running", activeTurn: { phase: "responding" } });
      expect(replica().status).toBe("running");
      expect(events.filter((event) => event.type === "turn_start")).toHaveLength(2);
      query.push(successfulResult);
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
    } finally { await runtime.stop(); }
  });

  it("does not let stale global idle end a new user turn or duplicate its start", async () => {
    const { query, runtime, events } = await createRuntimeForTest();
    try {
      await runtime.command({ type: "prompt", message: "First" });
      query.push(successfulResult);
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
      await runtime.command({ type: "prompt", message: "Second" });
      query.push({ type: "system", subtype: "session_state_changed", state: "idle" });
      query.push({ type: "system", subtype: "init", session_id: "native-session" });
      await nextTask();
      expect(runtime.snapshot().status).toBe("running");
      expect(events.filter((event) => event.type === "turn_start")).toHaveLength(2);
      query.push(successfulResult);
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
    } finally { await runtime.stop(); }
  });

  it("holds queued prompts while children work and releases them when the roster settles", async () => {
    const { query, runtime } = await createRuntimeForTest();
    vi.useFakeTimers();
    try {
      await runtime.command({ type: "prompt", message: "Research" });
      await runtime.command({ type: "queue", message: "Next request" }, "queued");
      query.push(backgroundTasks("child"));
      query.push(successfulResult);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(runtime.snapshot()).toMatchObject({ status: "running", activeTurn: { phase: "waiting" }, queuedMessages: [{ id: "queued" }] });
      expect(runtime.snapshot().error).toBeUndefined();
      query.push(backgroundTasks());
      await vi.advanceTimersByTimeAsync(0);
      expect(runtime.snapshot().queuedMessages).toEqual([]);
      const inputs = query.inputs[Symbol.asyncIterator]();
      expect((await inputs.next()).value).toMatchObject({ message: { content: "Research" } });
      expect((await inputs.next()).value).toMatchObject({ message: { content: "Next request" } });
    } finally { await runtime.stop(); vi.useRealTimers(); }
  });

  it("uses roster replacement, ignores late completion edges, and clears tasks on abort/restart", async () => {
    const { client, query, runtime } = await createRuntimeForTest();
    try {
      query.push(backgroundTasks("first", "second"));
      await nextTask();
      expect(runtime.snapshot().activeTurn?.phase).toBe("waiting");
      query.push(backgroundTasks());
      query.push({ type: "system", subtype: "task_started", task_id: "first", is_backgrounded: true });
      query.push({ type: "system", subtype: "task_notification", task_id: "first", status: "completed" });
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
      query.push(backgroundTasks("new-child"));
      await nextTask();
      await runtime.command({ type: "abort" });
      expect(await client.getState()).toMatchObject({ isStreaming: false, hasPendingAsyncWork: false });
      expect(runtime.snapshot().status).toBe("idle");
      query.push(backgroundTasks("stale-child"));
      await nextTask();
      expect((await client.getState()).hasPendingAsyncWork).toBe(false);
    } finally { await runtime.stop(); }
  });

  it("does not let settlement overwrite a wake in the same event burst", async () => {
    const { query, runtime, replica } = await createRuntimeForTest();
    try {
      await runtime.command({ type: "prompt", message: "Research" });
      query.push(backgroundTasks("child"));
      query.push(successfulResult);
      await nextTask();
      query.push(backgroundTasks());
      query.push({ type: "system", subtype: "init", session_id: "native-session" });
      await nextTask();
      expect(runtime.snapshot()).toMatchObject({ status: "running", activeTurn: { phase: "responding" } });
      expect(replica().status).toBe("running");
    } finally { await runtime.stop(); }
  });

  it("clears background activity when the query exits", async () => {
    const { client, query, runtime, replica } = await createRuntimeForTest();
    try {
      query.push(backgroundTasks("child"));
      await nextTask();
      query.close();
      await vi.waitFor(() => expect(runtime.snapshot().status).toBe("exited"));
      expect(replica().status).toBe("exited");
      expect(await client.getState()).toMatchObject({ isStreaming: false, hasPendingAsyncWork: false });
    } finally { await runtime.stop(); }
  });
});

describe("Claude runtime client", () => {
  it.each(["automatic", "manual"])(
    "keeps %s compaction separate from turn completion",
    async (trigger) => {
      const { client, query, events } = await createClientForTest();
      const runtime = new AgentSessionRuntime(
        "session",
        "connection",
        "workspace",
        claudeProviderAdapter,
        client,
        {
          state: await client.getState(),
          messages: (await client.getMessages()).messages,
          models: await client.getAvailableModels(),
          commands: await client.getCommands(),
          stats: await client.getSessionStats(),
        },
        {},
        async () => [],
        vi.fn(),
        vi.fn(),
        [],
        vi.fn(),
      );
      const releaseLease = runtime.acquireLease();
      vi.useFakeTimers();
      try {
        await runtime.command(
          trigger === "manual"
            ? { type: "compact" }
            : { type: "prompt", message: "Keep working" },
        );
        await runtime.command(
          { type: "queue", message: "Next request" },
          "queued",
        );
        query.push({ type: "system", subtype: "status", status: "compacting" });
        query.push({ type: "system", subtype: "status", status: "compacting" });
        query.push({
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: {
            trigger: trigger === "manual" ? "manual" : "auto",
            post_tokens: 30,
          },
        });
        // Compaction has finished, but Claude is still working on this turn.
        await vi.advanceTimersByTimeAsync(31_000);
        expect(runtime.snapshot()).toMatchObject({
          status: "running",
          state: { isStreaming: true, isCompacting: false },
          queuedMessages: [{ id: "queued", message: "Next request" }],
        });
        expect(runtime.snapshot().error).toBeUndefined();
        expect(
          events.filter((event) => event.type === "compaction_start"),
        ).toHaveLength(1);
        expect(
          events.filter((event) => event.type === "compaction_end"),
        ).toHaveLength(1);
        expect(events.some((event) => event.type === "turn_end")).toBe(false);

        query.push({ type: "result", subtype: "success", is_error: false, usage: {} });
        await vi.advanceTimersByTimeAsync(0);
        expect(runtime.snapshot().queuedMessages).toEqual([]);
        const currentInput = await query.inputs[Symbol.asyncIterator]().next();
        expect(currentInput.value).toMatchObject({
          message: { content: trigger === "manual" ? "/compact" : "Keep working" },
        });
        const nextInput = await query.inputs[Symbol.asyncIterator]().next();
        expect(nextInput.value).toMatchObject({
          message: { content: "Next request" },
        });
        query.push({ type: "result", subtype: "success", is_error: false, usage: {} });
        await vi.advanceTimersByTimeAsync(0);
        expect(runtime.snapshot().status).toBe("idle");
      } finally {
        await runtime.stop();
        releaseLease();
        vi.useRealTimers();
      }
    },
  );

  it.each([
    { result: "  Usage: 10 tokens  ", outputTokens: 0, error: false, expected: "Usage: 10 tokens" },
    { result: "Unknown command: /missing", outputTokens: 0, error: false, expected: "Unknown command: /missing" },
    { result: "   ", outputTokens: 0, error: false, expected: null },
    { result: "Model response", outputTokens: 42, error: false, expected: null },
    { result: "Unreported usage", outputTokens: undefined, error: false, expected: null },
    { result: "Command failed", outputTokens: 0, error: true, expected: null },
  ])("preserves command-only output for $result", async ({ result, outputTokens, error, expected }) => {
    const { client, query, events } = await createClientForTest();
    try {
      await client.prompt("/usage");
      query.push({
        type: "result", subtype: error ? "error_during_execution" : "success",
        uuid: "command-result", is_error: error, result,
        usage: { output_tokens: outputTokens },
      });
      await nextTask();
      const assistantMessages = (await client.getMessages()).messages.filter(
        (message) => (message as { role?: string }).role === "assistant",
      );
      if (expected) {
        expect(assistantMessages).toEqual([
          expect.objectContaining({ id: "command-result", content: [{ type: "text", text: expected }] }),
        ]);
        expect(events).toContainEqual(expect.objectContaining({
          type: "message_end",
          message: expect.objectContaining({ id: "command-result", content: [{ type: "text", text: expected }] }),
        }));
      } else {
        expect(assistantMessages).toEqual([]);
      }
      expect(events).toContainEqual({ type: "turn_end" });
      expect((await client.getState()).isStreaming).toBe(false);
      if (error) expect(events).toContainEqual({ type: "rpc_error", error: result });
    } finally {
      await client.stop();
    }
  });

  it.each(["assistant", "stream_event"])(
    "does not duplicate zero-token %s text and still shows the next command result",
    async (type) => {
      const { client, query } = await createClientForTest();
      try {
        await client.prompt("Answer");
        if (type === "assistant") {
          query.push({
            type, message: { id: "answer", content: [{ type: "text", text: "The answer" }] },
          });
        } else {
          query.push({ type, event: { type: "message_start", message: { id: "answer" } } });
          query.push({
            type, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The answer" } },
          });
        }
        query.push({
          type: "result", subtype: "success", is_error: false, uuid: "answer-result",
          result: "The answer", usage: { output_tokens: 0 },
        });
        await nextTask();
        expect((await client.getMessages()).messages).toHaveLength(2);

        await client.prompt("/usage");
        query.push({
          type: "result", subtype: "success", is_error: false, uuid: "usage-result",
          result: "Usage: 10 tokens", usage: { output_tokens: 0 },
        });
        await nextTask();
        expect((await client.getMessages()).messages).toEqual([
          expect.objectContaining({ role: "user" }),
          expect.objectContaining({ id: "answer", content: [{ type: "text", text: "The answer" }] }),
          expect.objectContaining({ role: "user" }),
          expect.objectContaining({ id: "usage-result", content: [{ type: "text", text: "Usage: 10 tokens" }] }),
        ]);
      } finally {
        await client.stop();
      }
    },
  );

  it("initializes without a prompt and streams a normalized turn", async () => {
    let query!: FakeQuery;
    queryMock.mockImplementation((params) => {
      query = new FakeQuery(params);
      return query;
    });
    const client = new ClaudeRuntimeClient(
      { transport: "local" },
      {
        executable: "/usr/bin/claude",
        cwd: "/workspace",
        model: "haiku",
        thinkingOptionId: "off",
        modeId: "auto",
      },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));

    const state = await client.getState();
    expect(state.sessionId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(query.options).toMatchObject({
      sessionId: state.sessionId,
      pathToClaudeCodeExecutable: "/usr/bin/claude",
      permissionMode: "auto",
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
    });
    expect(await client.getAvailableModels()).toContainEqual(
      expect.objectContaining({ id: "haiku", provider: "claude" }),
    );

    await client.prompt("hello", [], { clientMessageId: "prompt:1" });
    const input = await query.inputs[Symbol.asyncIterator]().next();
    expect(input.value).toMatchObject({
      type: "user",
      message: { role: "user", content: "hello" },
      origin: { kind: "human" },
    });
    query.push({
      type: "assistant",
      uuid: "00000000-0000-4000-8000-000000000002",
      session_id: state.sessionId,
      parent_tool_use_id: null,
      message: {
        id: "message-1",
        role: "assistant",
        content: [{ type: "text", text: "hello back" }],
      },
    });
    query.push({
      type: "result",
      subtype: "success",
      uuid: "00000000-0000-4000-8000-000000000003",
      session_id: state.sessionId,
      is_error: false,
      result: "hello back",
      usage: {
        input_tokens: 2,
        output_tokens: 3,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      total_cost_usd: 0.001,
    });
    await nextTask();

    expect(events).toContainEqual(expect.objectContaining({ type: "turn_start" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          id: "message-1",
          content: [{ type: "text", text: "hello back" }],
        }),
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "turn_end" }));
    expect(await client.getSessionStats()).toMatchObject({
      tokens: { input: 2, output: 3, total: 5 },
      cost: 0.001,
    });
    await client.stop();
  });

  it("binds a first prompt to the fresh query when a restart is already queued", async () => {
    const queries: FakeQuery[] = [];
    queryMock.mockImplementation((params) => {
      const query = new FakeQuery(params);
      queries.push(query);
      return query;
    });
    const client = new ClaudeRuntimeClient(
      { transport: "local" },
      { executable: "claude", cwd: "/workspace", modeId: "default" },
    );
    await client.getState();

    const restart = client.setThinkingLevel("off");
    const prompt = client.prompt("after restart");
    await Promise.all([restart, prompt]);

    expect(queries).toHaveLength(2);
    expect(queries[1]?.options).toMatchObject({
      sessionId: queries[0]!.options.sessionId,
      thinking: { type: "disabled" },
    });
    await expect(
      queries[0]!.inputs[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({ done: true });
    await expect(
      queries[1]!.inputs[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({
      done: false,
      value: expect.objectContaining({
        type: "user",
        message: { role: "user", content: "after restart" },
      }),
    });
    await client.stop();
  });

  it("maps tool approval and persistent permission suggestions", async () => {
    let query!: FakeQuery;
    queryMock.mockImplementation((params) => {
      query = new FakeQuery(params);
      return query;
    });
    const client = new ClaudeRuntimeClient(
      { transport: "local" },
      { executable: "claude", cwd: "/workspace", modeId: "default" },
    );
    await client.getState();
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    const canUseTool = query.options.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    const controller = new AbortController();
    const decision = canUseTool(
      "Bash",
      { command: "npm test" },
      {
        signal: controller.signal,
        requestId: "permission-1",
        toolUseID: "tool-1",
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "npm test" }],
            behavior: "allow",
            destination: "session",
          },
        ],
      },
    );
    await nextTask();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "interaction_request",
        id: "claude:permission:permission-1",
        approvalKind: "tool",
        toolDetail: { type: "shell", command: "npm test" },
      }),
    );
    client.respondToInteraction("claude:permission:permission-1", {
      value: "Allow always",
    });
    await expect(decision).resolves.toMatchObject({
      behavior: "allow",
      decisionClassification: "user_permanent",
      updatedPermissions: [expect.objectContaining({ destination: "session" })],
    });
    await client.stop();
  });
  it("preserves question descriptions and returns custom and multiple answers", async () => {
    let query!: FakeQuery;
    queryMock.mockImplementation((params) => (query = new FakeQuery(params)));
    const client = new ClaudeRuntimeClient(
      { transport: "local" },
      { executable: "claude", cwd: "/workspace" },
    );
    await client.getState();
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    const ask = query.options.canUseTool as (
      name: string, input: Record<string, unknown>, options: Record<string, unknown>,
    ) => Promise<unknown>;
    const decision = ask("AskUserQuestion", {
      questions: [
        { header: "Framework", question: "Which framework?", options: [{ label: "React", description: "Existing components" }] },
        { header: "Features", question: "Which features?", multiSelect: true, options: [{ label: "Search" }, { label: "History" }] },
      ],
    }, { signal: new AbortController().signal, requestId: "questions", toolUseID: "ask" });
    expect(events.at(-1)).toMatchObject({
      method: "form",
      fields: [
        expect.objectContaining({ id: "0", allowOther: true, options: [{ value: "React", label: "React", description: "Existing components" }] }),
        expect.objectContaining({ id: "1", type: "multiselect", allowOther: true }),
      ],
    });
    client.respondToInteraction("claude:question:questions", { values: { "0": "Custom framework", "1": ["Search", "History"] } });
    await expect(decision).resolves.toMatchObject({ behavior: "allow", updatedInput: { answers: { "Which framework?": "Custom framework", "Which features?": "Search, History" } } });
    await client.stop();
  });


  it.each([30, null, 0])("preserves compacted context %s through zero-token request events", async (postTokens) => {
    let query!: FakeQuery;
    queryMock.mockImplementation((params) => (query = new FakeQuery(params)));
    const client = new ClaudeRuntimeClient(
      { transport: "local" },
      { executable: "claude", cwd: "/workspace", model: "haiku" },
    );
    await client.getState();
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    const push = async (message: unknown) => {
      query.push(message);
      await nextTask();
    };
    const usage = {
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
    };
    try {
      await push({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: postTokens === null ? {} : { post_tokens: postTokens },
      });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(postTokens);
      events.length = 0;
      await push({
        type: "stream_event",
        event: { type: "message_start", message: { id: "placeholder", usage } },
      });
      await push({
        type: "stream_event",
        event: { type: "message_delta", usage: { output_tokens: 0 } },
      });
      await push({
        type: "assistant",
        message: { id: "placeholder", content: [], usage },
      });
      await push({ type: "result", usage, total_cost_usd: 0 });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(postTokens);
      expect(events.filter((event) => event.type === "usage_update")).not.toContainEqual(
        expect.objectContaining({ usage: { contextUsage: expect.anything() } }),
      );
      // Cached input is real usage even when uncached input and output are zero.
      await push({
        type: "stream_event",
        event: {
          type: "message_start",
          message: { id: "next", usage: { ...usage, cache_read_input_tokens: 12 } },
        },
      });
      await push({
        type: "stream_event",
        event: { type: "message_delta", usage: { output_tokens: 0 } },
      });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(12);
    } finally {
      await client.stop();
    }
  });

  it("streams root context usage including caches and clears stale counts on compaction", async () => {
    let query!: FakeQuery;
    queryMock.mockImplementation((params) => {
      query = new FakeQuery(params);
      const initialized = query.initializationResult();
      query.initializationResult = async () => {
        const result = await initialized;
        return {
          ...result,
          models: result.models.map((model) => ({
            ...model,
            resolvedModel: "claude-haiku-test",
          })),
        };
      };
      return query;
    });
    const client = new ClaudeRuntimeClient(
      { transport: "local" },
      { executable: "claude", cwd: "/workspace", model: "haiku" },
    );
    await client.getState();
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    const stream = async (
      event: unknown,
      parent_tool_use_id: string | null = null,
    ) => {
      query.push({ type: "stream_event", parent_tool_use_id, event });
      await nextTask();
    };
    try {
      query.push({
        type: "system",
        subtype: "init",
        session_id: "claude-session",
        model: "claude-haiku-test",
      });
      await nextTask();
      await stream({
        type: "message_start",
        message: {
          id: "one",
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 25,
          },
        },
      });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(175);
      await stream({ type: "message_delta", usage: { output_tokens: 10 } });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(185);
      await stream(
        {
          type: "message_start",
          message: { id: "child", usage: { input_tokens: 99999 } },
        },
        "child-tool",
      );
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(185);
      query.push({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { post_tokens: 30 },
      });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(30);
      query.push({
        type: "result",
        usage: { input_tokens: 999999, output_tokens: 20000 },
        modelUsage: { haiku: { contextWindow: 200000 } },
        total_cost_usd: 1,
      });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(30);
      query.push({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { pre_tokens: 30 },
      });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.tokens).toBeNull();
      await stream({ type: "message_delta", usage: { output_tokens: 100 } });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBeNull();
      await stream({
        type: "message_start",
        message: { id: "next", usage: { input_tokens: 20 } },
      });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(20);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "usage_update",
          usage: { contextUsage: expect.objectContaining({ tokens: 185 }) },
        }),
      );
    } finally {
      await client.stop();
    }
  });
});


describe("Claude rewind persistence", () => {
  // Repeated forks and reopens spawn real host processes; allow for shared CI runner load.
  it("reopens without another prompt, remaps checkpoints, and can rewind again", async () => {
    configureLocalTestProcessSpawner();
    const f = await claudeRewindFixture();
    const queries: FakeQuery[] = [];
    queryMock.mockImplementation((params) => {
      const q = new FakeQuery(params); queries.push(q); return q;
    });
    const launch = { executable: "claude", cwd: f.cwd, modeId: "default", resume: {
      providerSessionId: f.sessionId, providerSessionPath: f.sessionPath,
    } };
    let client = new ClaudeRuntimeClient({ transport: "local" }, launch);
    try {
      await client.rewind(f.ids[4]!, "conversation");
      const state = await client.getState();
      expect(queries.at(-1)!.options).toMatchObject({ resume: state.sessionId });
      expect(queries.at(-1)!.options.forkSession).toBeUndefined();
      await client.stop();
      client = new ClaudeRuntimeClient({ transport: "local" }, { ...launch, resume: {
        providerSessionId: state.sessionId as string, providerSessionPath: state.sessionFile as string,
      } });
      const messages = (await client.getMessages()).messages as Array<{ id: string }>;
      expect(messages).toHaveLength(4);
      await client.rewind(messages[2]!.id, "conversation");
      expect((await client.getMessages()).messages).toHaveLength(2);
      const first = (await client.getMessages()).messages[0] as { id: string };
      await client.rewind(first.id, "conversation");
      const empty = await client.getState();
      await client.stop();
      client = new ClaudeRuntimeClient({ transport: "local" }, { ...launch, resume: {
        providerSessionId: empty.sessionId as string, providerSessionPath: empty.sessionFile as string,
      } });
      expect((await client.getMessages()).messages).toEqual([]);
      expect(queries.at(-1)!.options).toMatchObject({ sessionId: empty.sessionId });
      expect(queries.at(-1)!.options.resume).toBeUndefined();
    } finally { await client.stop(); await rm(f.root, { recursive: true, force: true }); }
  }, 30_000);

  it("retains the original session identity and messages when persistence fails", async () => {
    configureLocalTestProcessSpawner();
    const f = await claudeRewindFixture();
    queryMock.mockImplementation((params) => new FakeQuery(params));
    const client = new ClaudeRuntimeClient({ transport: "local" }, {
      executable: "claude", cwd: f.cwd, modeId: "default", resume: {
        providerSessionId: f.sessionId, providerSessionPath: f.sessionPath,
      },
    });
    try {
      await client.getState();
      await unlink(f.sessionPath);
      await expect(client.rewind(f.ids[4]!, "conversation")).rejects.toThrow();
      expect((await client.getState()).sessionId).toBe(f.sessionId);
      expect((await client.getMessages()).messages).toHaveLength(6);
    } finally { await client.stop(); await rm(f.root, { recursive: true, force: true }); }
  });
});


it("restores the old live identity if opening a persisted fork fails", async () => {
  configureLocalTestProcessSpawner();
  const f = await claudeRewindFixture();
  let starts = 0;
  queryMock.mockImplementation((params) => {
    const query = new FakeQuery(params);
    if (++starts === 2) vi.spyOn(query, "initializationResult").mockRejectedValue(new Error("startup failed"));
    return query;
  });
  const client = new ClaudeRuntimeClient({ transport: "local" }, {
    executable: "claude", cwd: f.cwd, modeId: "default", resume: {
      providerSessionId: f.sessionId, providerSessionPath: f.sessionPath,
    },
  });
  try {
    await expect(client.rewind(f.ids[4]!, "conversation")).rejects.toThrow("startup failed");
    expect(await client.getState()).toMatchObject({ sessionId: f.sessionId, sessionFile: f.sessionPath });
    expect((await client.getMessages()).messages).toHaveLength(6);
    await client.rewind(f.ids[4]!, "conversation");
    expect((await client.getState()).sessionId).not.toBe(f.sessionId);
    expect((await client.getMessages()).messages).toHaveLength(4);
  } finally { await client.stop(); await rm(f.root, { recursive: true, force: true }); }
});


it.each(["files", "both"] as const)("restores files on the source session before a %s rewind", async (mode) => {
  configureLocalTestProcessSpawner();
  const f = await claudeRewindFixture();
  const queries: FakeQuery[] = [];
  queryMock.mockImplementation((params) => {
    const query = new FakeQuery(params); queries.push(query); return query;
  });
  const client = new ClaudeRuntimeClient({ transport: "local" }, {
    executable: "claude", cwd: f.cwd, modeId: "default", resume: {
      providerSessionId: f.sessionId, providerSessionPath: f.sessionPath,
    },
  });
  try {
    await client.getState();
    const source = queries[0]!;
    source.rewindFiles.mockResolvedValueOnce({ canRewind: false });
    await expect(client.rewind(f.ids[4]!, mode)).rejects.toThrow("No file checkpoint");
    expect((await client.getState()).sessionId).toBe(f.sessionId);
    expect(queries).toHaveLength(1);
    await client.rewind(f.ids[4]!, mode);
    expect(source.rewindFiles).toHaveBeenLastCalledWith(f.ids[4], { dryRun: false });
    expect(queries).toHaveLength(mode === "files" ? 1 : 2);
    expect((await client.getMessages()).messages).toHaveLength(mode === "files" ? 6 : 4);
  } finally { await client.stop(); await rm(f.root, { recursive: true, force: true }); }
});


describe("Claude context reporting", () => {
  it("reads native capacity on open and streams usage for an unmatched runtime model", async () => {
    let q!: FakeQuery;
    queryMock.mockImplementation((params) => {
      q = new FakeQuery(params);
      q.getContextUsage.mockReset().mockResolvedValue({ totalTokens: 18_000, maxTokens: 1_000_000 });
      return q;
    });
    const client = new ClaudeRuntimeClient({ transport: "local" }, { executable: "claude", cwd: "/workspace" });
    try {
      expect((await client.getSessionStats()).contextUsage).toMatchObject({ tokens: 18_000, contextWindow: 1_000_000 });
      q.push({ type: "system", subtype: "init", model: "gateway/native-opus", session_id: "session" });
      q.push({ type: "stream_event", event: { type: "message_start", message: { usage: {
        input_tokens: 16_000, cache_read_input_tokens: 500_000,
      } } } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage).toEqual({ tokens: 516_000, contextWindow: 1_000_000, percent: 51.6 });
    } finally { await client.stop(); }
  });

  it("invalidates a capacity when a native command changes the runtime model", async () => {
    let q!: FakeQuery;
    queryMock.mockImplementation((params) => {
      q = new FakeQuery(params);
      q.getContextUsage.mockReset()
        .mockResolvedValueOnce({ model: "claude-haiku-4-5", totalTokens: 10_000, maxTokens: 200_000 })
        .mockRejectedValue(new Error("Unsupported"));
      return q;
    });
    const client = new ClaudeRuntimeClient({ transport: "local" }, { executable: "claude", cwd: "/workspace" });
    try {
      await client.getState();
      q.push({ type: "system", subtype: "init", model: "claude-opus-4-7", session_id: "session" });
      q.push({ type: "assistant", message: { id: "a", content: [], usage: { input_tokens: 516_000 } } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage).toBeUndefined();
      q.push({ type: "result", modelUsage: { "claude-opus-4-7": { contextWindow: 1_000_000 } } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.percent).toBe(51.6);
    } finally { await client.stop(); }
  });

  it("merges corrected delta counters without summing cumulative updates or losing omitted fields", async () => {
    const { client, query } = await createClientForTest();
    try {
      query.push({ type: "stream_event", event: { type: "message_start", message: { usage: {
        input_tokens: 0, cache_read_input_tokens: 0,
      } } } });
      query.push({ type: "stream_event", event: { type: "message_delta", usage: {
        input_tokens: 16_000, cache_read_input_tokens: 500_000, output_tokens: 100,
      } } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(516_100);
      query.push({ type: "stream_event", event: { type: "message_delta", usage: { cache_creation_input_tokens: 50 } } });
      query.push({ type: "stream_event", event: { type: "message_delta", usage: { output_tokens: 200 } } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(516_250);
    } finally { await client.stop(); }
  });

  it("keeps unknown capacity honest and recovers retained tokens from the active result model", async () => {
    let q!: FakeQuery;
    queryMock.mockImplementation((params) => {
      q = new FakeQuery(params);
      q.getContextUsage.mockReset().mockRejectedValue(new Error("Unsupported"));
      return q;
    });
    const client = new ClaudeRuntimeClient({ transport: "local" }, { executable: "claude", cwd: "/workspace" });
    try {
      await client.getState();
      q.push({ type: "system", subtype: "init", model: "claude-opus-4-7[1m]", session_id: "session" });
      q.push({ type: "assistant", message: { id: "a", content: [], usage: { input_tokens: 516_000 } } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage).toBeUndefined();
      q.push({ type: "result", modelUsage: { haiku: { contextWindow: 200_000 } } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage).toBeUndefined();
      q.push({ type: "result", modelUsage: {
        "claude-opus-4-7": { contextWindow: 1_000_000 }, haiku: { contextWindow: 200_000 },
      } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage).toEqual({ tokens: 516_000, contextWindow: 1_000_000, percent: 51.6 });
    } finally { await client.stop(); }
  });

  it.each([false, true])("uses the last iteration when parent usage is absent or empty (%s)", async (emptyStart) => {
    const { client, query } = await createClientForTest();
    try {
      if (emptyStart) query.push({ type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 0 } } } });
      query.push({ type: "result", usage: { input_tokens: 9_000_000, iterations: [
        { input_tokens: 100_000 }, { input_tokens: 50, cache_read_input_tokens: 30_000, output_tokens: 10 },
      ] } });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(30_060);
    } finally { await client.stop(); }
  });

  it("does not let an idle native refresh overwrite a newer turn or compaction", async () => {
    const { client, query } = await createClientForTest();
    let resolve!: (value: unknown) => void;
    query.getContextUsage.mockImplementation(() => new Promise((done) => { resolve = done; }));
    try {
      query.push({ type: "result", usage: {} });
      await nextTask();
      await client.prompt("next");
      query.push({ type: "system", subtype: "compact_boundary", compact_metadata: { post_tokens: 30 } });
      await nextTask();
      resolve({ totalTokens: 150_000, maxTokens: 200_000 });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(30);
    } finally { await client.stop(); }
  });

  it("refreshes a model switch and ignores a pending response for the old model", async () => {
    const { client, query } = await createClientForTest();
    let resolve!: (value: unknown) => void;
    query.getContextUsage.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    try {
      query.push({ type: "result", usage: {} });
      await nextTask();
      query.getContextUsage.mockResolvedValue({ totalTokens: 25_000, maxTokens: 1_000_000 });
      await client.setModel("haiku");
      resolve({ totalTokens: 150_000, maxTokens: 200_000 });
      await nextTask();
      expect((await client.getSessionStats()).contextUsage).toEqual({ tokens: 25_000, contextWindow: 1_000_000, percent: 2.5 });
    } finally { await client.stop(); }
  });

  it("bounds unsupported context controls without blocking session initialization", async () => {
    vi.useFakeTimers();
    let q!: FakeQuery;
    queryMock.mockImplementation((params) => {
      q = new FakeQuery(params);
      q.getContextUsage.mockReset().mockImplementation(() => new Promise(() => {}));
      return q;
    });
    const client = new ClaudeRuntimeClient({ transport: "local" }, { executable: "claude", cwd: "/workspace" });
    try {
      await vi.waitFor(() => expect(q?.getContextUsage).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(5_001);
      await expect(client.getState()).resolves.toHaveProperty("sessionId");
      expect((await client.getSessionStats()).contextUsage).toBeUndefined();
    } finally { await client.stop(); vi.useRealTimers(); }
  });

  it("restores a resumed session's reading without sending a prompt", async () => {
    configureLocalTestProcessSpawner();
    const fixture = await claudeRewindFixture();
    queryMock.mockImplementation((params) => {
      const q = new FakeQuery(params);
      q.getContextUsage.mockReset().mockResolvedValue({ totalTokens: 42_000, maxTokens: 1_000_000 });
      return q;
    });
    const client = new ClaudeRuntimeClient({ transport: "local" }, {
      executable: "claude", cwd: fixture.cwd, resume: {
        providerSessionId: fixture.sessionId, providerSessionPath: fixture.sessionPath,
      },
    });
    try {
      expect((await client.getMessages()).messages.length).toBeGreaterThan(0);
      expect((await client.getSessionStats()).contextUsage).toEqual({ tokens: 42_000, contextWindow: 1_000_000, percent: 4.2 });
    } finally { await client.stop(); await rm(fixture.root, { recursive: true, force: true }); }
  });
});
