import { describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));

import { ClaudeRuntimeClient } from "./client";

class FakeQuery implements AsyncIterator<unknown> {
  readonly inputs: AsyncIterable<unknown>;
  readonly options: Record<string, unknown>;
  readonly setModel = vi.fn(async () => {});
  readonly setPermissionMode = vi.fn(async () => {});
  readonly interrupt = vi.fn(async () => ({ still_queued: [] }));
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

describe("Claude runtime client", () => {
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

  it("binds a prompt to the resumed query when a restart is already queued", async () => {
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
      resume: expect.any(String),
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
});
