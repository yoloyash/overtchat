import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  listCodexCustomPrompts: vi.fn(),
}));

vi.mock("./commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./commands")>()),
  listCodexCustomPrompts: mocks.listCodexCustomPrompts,
}));

type Listener<T> = (value: T) => void;

class FakeCodexServer {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  resumeError: Error | null = null;
  private notification: Listener<{ method: string; params?: unknown }> =
    () => {};
  private serverRequest: Listener<{
    id: string | number;
    method: string;
    params?: unknown;
  }> = () => {};

  ready = vi.fn(async () => {});
  stop = vi.fn(async () => {});

  onNotification(listener: typeof this.notification) {
    this.notification = listener;
    return () => {};
  }

  onRequest(listener: typeof this.serverRequest) {
    this.serverRequest = listener;
    return () => {};
  }

  async request(method: string, params: unknown) {
    this.requests.push({ method, params });
    if (method === "model/list") {
      return {
        data: [
          {
            id: "gpt-5.6",
            model: "gpt-5.6",
            displayName: "GPT-5.6",
            inputModalities: ["text"],
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "" },
              { reasoningEffort: "high", description: "" },
            ],
            defaultReasoningEffort: "high",
          },
        ],
        nextCursor: null,
      };
    }
    if (method === "skills/list") {
      return {
        data: [
          {
            cwd: "/workspace",
            skills: [
              {
                name: "release-notes",
                path: "/workspace/.codex/skills/release-notes/SKILL.md",
                description: "Draft release notes",
                enabled: true,
              },
            ],
          },
        ],
      };
    }
    if (method === "thread/start") {
      return {
        thread: {
          id: "thread-1",
          cwd: "/workspace",
          preview: "",
          path: "/tmp/thread-1.jsonl",
          name: null,
          createdAt: 1,
          updatedAt: 1,
          turns: [],
        },
        model: "gpt-5.6",
        reasoningEffort: "high",
      };
    }
    if (method === "thread/resume") {
      if (this.resumeError) throw this.resumeError;
      return {
        thread: {
          id: "thread-1",
          cwd: "/workspace",
          preview: "Resume this thread",
          path: "/tmp/thread-1.jsonl",
          name: null,
          createdAt: 1,
          updatedAt: 2,
          turns: [],
        },
        model: "gpt-5.6",
        reasoningEffort: "high",
      };
    }
    if (method === "thread/read") {
      return {
        thread: {
          id: "thread-1",
          cwd: "/workspace",
          preview: "Resume this thread",
          path: "/tmp/thread-1.jsonl",
          name: null,
          createdAt: 1,
          updatedAt: 2,
          turns: [
            {
              id: "turn-history",
              status: "completed",
              startedAt: 1,
              completedAt: 2,
              items: [
                {
                  id: "user-history",
                  type: "userMessage",
                  content: [
                    {
                      type: "text",
                      text: "Resume this thread",
                      text_elements: [],
                    },
                  ],
                },
                {
                  id: "assistant-history",
                  type: "agentMessage",
                  text: "History restored.",
                },
              ],
            },
          ],
        },
      };
    }
    if (method === "turn/start") {
      return {
        turn: {
          id: "turn-1",
          status: "inProgress",
          startedAt: 10,
          items: [],
        },
      };
    }
    return {};
  }

  respond(id: string | number, result: unknown) {
    this.responses.push({ id, result });
  }

  respondError = vi.fn();

  emit(method: string, params?: unknown) {
    this.notification({ method, params });
  }

  ask(id: string | number, method: string, params?: unknown) {
    this.serverRequest({ id, method, params });
  }
}

const server = new FakeCodexServer();

vi.mock("./app-server", () => ({
  startCodexAppServer: () => server,
}));

import { CodexRuntimeClient } from "./client";

describe("CodexRuntimeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.requests.length = 0;
    server.responses.length = 0;
    server.resumeError = null;
    server.respondError.mockClear();
    mocks.listCodexCustomPrompts.mockResolvedValue([
      {
        name: "prompts:review",
        description: "Review a path",
        argumentHint: "<path>",
        source: "prompt",
        template: "Review $1 carefully.",
      },
    ]);
  });

  it("discovers and invokes native skills and custom prompts", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );

    await expect(client.getCommands()).resolves.toEqual([
      {
        name: "prompts:review",
        description: "Review a path",
        argumentHint: "<path>",
        source: "prompt",
      },
      {
        name: "release-notes",
        description: "Draft release notes",
        source: "skill",
      },
    ]);

    await client.prompt("/release-notes v1.2.3");
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        input: [
          {
            type: "skill",
            name: "release-notes",
            path: "/workspace/.codex/skills/release-notes/SKILL.md",
          },
          {
            type: "text",
            text: "$release-notes v1.2.3",
            text_elements: [],
          },
        ],
      },
    });

    await client.prompt('/prompts:review "src/a b.ts"');
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        input: [
          {
            type: "text",
            text: "Review src/a b.ts carefully.",
            text_elements: [],
          },
        ],
      },
    });
  });

  it("refreshes native skills when Codex reports a change", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getCommands();

    server.emit("skills/changed", {});
    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "available_commands_update",
          commands: expect.arrayContaining([
            expect.objectContaining({
              name: "release-notes",
              source: "skill",
            }),
          ]),
        }),
      );
    });
  });

  it("starts a native thread and maps streamed activity", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));

    await expect(client.getState()).resolves.toMatchObject({
      sessionId: "thread-1",
      sessionFile: "/tmp/thread-1.jsonl",
      isStreaming: false,
      model: { provider: "codex", id: "gpt-5.6" },
      thinkingLevel: "high",
    });
    await client.prompt("Inspect the tests");
    server.emit("turn/started", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "inProgress",
        startedAt: 10,
        items: [],
      },
    });
    server.emit("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      startedAtMs: 10_001,
      item: {
        id: "command-1",
        type: "commandExecution",
        command: "npm test",
        cwd: "/workspace",
        status: "inProgress",
        aggregatedOutput: "",
      },
    });
    server.emit("item/commandExecution/outputDelta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "command-1",
      delta: "passed\n",
    });
    server.emit("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        startedAt: 10,
        completedAt: 11,
        items: [
          {
            id: "command-1",
            type: "commandExecution",
            command: "npm test",
            cwd: "/workspace",
            status: "completed",
            aggregatedOutput: "passed\n",
            exitCode: 0,
          },
          {
            id: "assistant-1",
            type: "agentMessage",
            text: "Everything passes.",
          },
        ],
      },
    });

    await expect(client.getState()).resolves.toMatchObject({
      isStreaming: false,
    });
    await expect(client.getMessages()).resolves.toEqual({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "Inspect the tests",
        }),
        expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "toolCall",
              name: "bash",
            }),
            { type: "text", text: "Everything passes." },
          ]),
        }),
        expect.objectContaining({
          role: "toolResult",
          toolCallId: "command-1",
          isError: false,
        }),
      ]),
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn_start", turnId: "turn-1" }),
        expect.objectContaining({
          type: "message_update",
          message: expect.objectContaining({
            role: "user",
            content: "Inspect the tests",
          }),
        }),
        expect.objectContaining({ type: "message_update" }),
        expect.objectContaining({ type: "turn_end", status: "completed" }),
      ]),
    );
  });

  it("hydrates complete native history after resuming a thread", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        resume: {
          providerSessionId: "thread-1",
          providerSessionPath: "/tmp/thread-1.jsonl",
        },
      },
    );

    await expect(client.getMessages()).resolves.toEqual({
      messages: expect.arrayContaining([
        expect.objectContaining({
          id: "user-history",
          role: "user",
          content: "Resume this thread",
        }),
        expect.objectContaining({
          id: "turn-history:assistant",
          role: "assistant",
          content: [{ type: "text", text: "History restored." }],
        }),
      ]),
    });
    expect(server.requests).toEqual(
      expect.arrayContaining([
        {
          method: "thread/resume",
          params: { threadId: "thread-1", cwd: "/workspace" },
        },
        {
          method: "thread/read",
          params: { threadId: "thread-1", includeTurns: true },
        },
      ]),
    );
  });

  it("unsubscribes a resumed thread before stopping its app-server", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        resume: {
          providerSessionId: "thread-1",
          providerSessionPath: "/tmp/thread-1.jsonl",
        },
      },
    );
    await client.getState();

    await client.stop();

    expect(server.requests.at(-1)).toEqual({
      method: "thread/unsubscribe",
      params: { threadId: "thread-1" },
    });
    expect(server.stop).toHaveBeenCalledOnce();
  });

  it("opens an active-writer thread read-only and retries interactive access", async () => {
    server.resumeError = new Error(
      "thread thread-1 already has an active writer",
    );
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        resume: {
          providerSessionId: "thread-1",
          providerSessionPath: "/tmp/thread-1.jsonl",
        },
      },
    );

    await expect(client.getState()).resolves.toMatchObject({
      sessionId: "thread-1",
      isStreaming: false,
      readOnly: {
        reason: expect.stringContaining("Codex process currently owns"),
        retryable: true,
      },
    });
    await expect(client.getMessages()).resolves.toEqual({
      messages: expect.arrayContaining([
        expect.objectContaining({
          id: "user-history",
          content: "Resume this thread",
        }),
        expect.objectContaining({
          id: "turn-history:assistant",
        }),
      ]),
    });
    await expect(client.prompt("Continue here")).rejects.toThrow(
      "Codex process currently owns",
    );

    server.resumeError = null;
    await client.retryInteractive();
    const state = await client.getState();
    expect(state).not.toHaveProperty("readOnly");
    expect(
      server.requests.filter(({ method }) => method === "thread/resume"),
    ).toHaveLength(2);
  });

  it("round-trips native approvals through the generic interaction contract", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    server.ask("approval-1", "item/commandExecution/requestApproval", {
      command: "npm install",
      reason: "Requires network access",
    });
    expect(events.at(-1)).toMatchObject({
      type: "interaction_request",
      id: "codex:approval-1",
      method: "select",
      options: ["Allow once", "Allow for session", "Deny"],
    });

    client.respondToInteraction("codex:approval-1", {
      value: "Allow for session",
    });
    expect(server.responses.at(-1)).toEqual({
      id: "approval-1",
      result: { decision: "acceptForSession" },
    });

    server.ask("permission-1", "item/permissions/requestApproval", {
      reason: "Needs network access",
      permissions: {
        network: { enabled: true },
        fileSystem: null,
      },
    });
    client.respondToInteraction("codex:permission-1", {
      value: "Allow once",
    });
    expect(server.responses.at(-1)).toEqual({
      id: "permission-1",
      result: {
        permissions: { network: { enabled: true } },
        scope: "turn",
      },
    });
  });

  it("waits for the interrupted turn to become terminal", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();
    await client.prompt("Keep working");

    let settled = false;
    const abort = client.abort().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(server.requests.at(-1)).toEqual({
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });

    server.emit("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "interrupted",
        startedAt: 10,
        completedAt: 11,
        items: [],
      },
    });
    await abort;
    expect(settled).toBe(true);
  });

  it("waits for the compaction turn to complete", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    let settled = false;
    const compact = client.compact().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(client.getState()).resolves.toMatchObject({
      isCompacting: true,
    });

    server.emit("turn/started", {
      threadId: "thread-1",
      turn: {
        id: "compact-turn",
        status: "inProgress",
        startedAt: 20,
        items: [],
      },
    });
    server.emit("item/started", {
      threadId: "thread-1",
      turnId: "compact-turn",
      item: { id: "compact-item", type: "contextCompaction" },
    });
    server.emit("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "compact-turn",
        status: "completed",
        startedAt: 20,
        completedAt: 21,
        items: [{ id: "compact-item", type: "contextCompaction" }],
      },
    });
    await compact;

    expect(settled).toBe(true);
    await expect(client.getState()).resolves.toMatchObject({
      isCompacting: false,
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "compaction_start" }),
        expect.objectContaining({ type: "compaction_end" }),
      ]),
    );
  });

  it("maps secret questions and clears requests resolved by app-server", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    server.ask("question-1", "item/tool/requestUserInput", {
      autoResolutionMs: 5_000,
      questions: [
        {
          id: "token",
          header: "Token",
          question: "Enter the token",
          isOther: false,
          isSecret: true,
          options: null,
        },
      ],
    });
    expect(events.at(-1)).toMatchObject({
      type: "interaction_request",
      id: "codex:question-1",
      method: "input",
      secret: true,
      timeout: 5_000,
    });

    server.emit("serverRequest/resolved", {
      threadId: "thread-1",
      requestId: "question-1",
    });
    expect(events.at(-1)).toEqual({
      type: "interaction_resolved",
      id: "codex:question-1",
    });
  });

  it("supports legacy Codex user-input requests", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    server.ask("legacy-question", "tool/requestUserInput", {
      questions: [
        {
          id: "choice",
          header: "Choose",
          question: "Which path?",
          isOther: false,
          isSecret: false,
          options: [
            { label: "A", description: "First" },
            { label: "B", description: "Second" },
          ],
        },
      ],
    });
    expect(events.at(-1)).toMatchObject({
      type: "interaction_request",
      id: "codex:legacy-question",
      method: "select",
      options: ["A", "B"],
    });

    client.respondToInteraction("codex:legacy-question", { value: "B" });
    expect(server.responses.at(-1)).toEqual({
      id: "legacy-question",
      result: {
        answers: {
          choice: { answers: ["B"] },
        },
      },
    });
  });

  it("handles typed MCP elicitation forms and authorization URLs", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    server.ask("mcp-form", "mcpServer/elicitation/request", {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "GitHub",
      mode: "form",
      message: "Configure the GitHub tool",
      requestedSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            title: "Token",
            description: "Personal access token",
          },
          environment: {
            type: "string",
            title: "Environment",
            enum: ["production", "staging"],
            enumNames: ["Production", "Staging"],
          },
          scopes: {
            type: "array",
            title: "Scopes",
            items: {
              type: "string",
              enum: ["repo", "issues"],
            },
          },
          private: {
            type: "boolean",
            title: "Private repository",
            default: false,
          },
        },
        required: ["token", "environment"],
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "interaction_request",
      id: "codex:mcp-form",
      method: "form",
      title: "GitHub needs your input",
      fields: [
        expect.objectContaining({
          id: "token",
          type: "text",
          required: true,
        }),
        expect.objectContaining({
          id: "environment",
          type: "select",
          options: [
            { value: "production", label: "Production" },
            { value: "staging", label: "Staging" },
          ],
        }),
        expect.objectContaining({
          id: "scopes",
          type: "multiselect",
        }),
        expect.objectContaining({
          id: "private",
          type: "boolean",
          defaultValue: false,
        }),
      ],
    });
    client.respondToInteraction("codex:mcp-form", {
      values: {
        token: "secret",
        environment: "staging",
        scopes: ["repo"],
        private: false,
      },
    });
    expect(server.responses.at(-1)).toEqual({
      id: "mcp-form",
      result: {
        action: "accept",
        content: {
          token: "secret",
          environment: "staging",
          scopes: ["repo"],
          private: false,
        },
        _meta: null,
      },
    });

    server.ask("mcp-url", "mcpServer/elicitation/request", {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "GitHub",
      mode: "url",
      message: "Authorize GitHub",
      url: "https://github.com/login/oauth/authorize",
      elicitationId: "oauth-1",
    });
    expect(events.at(-1)).toMatchObject({
      type: "interaction_request",
      id: "codex:mcp-url",
      method: "external",
      url: "https://github.com/login/oauth/authorize",
    });
    client.respondToInteraction("codex:mcp-url", { confirmed: true });
    expect(server.responses.at(-1)).toEqual({
      id: "mcp-url",
      result: {
        action: "accept",
        content: null,
        _meta: null,
      },
    });
  });

  it("uses current-turn usage for context while retaining cumulative totals", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();

    server.emit("thread/tokenUsage/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      tokenUsage: {
        total: {
          inputTokens: 80_000,
          cachedInputTokens: 10_000,
          cacheWriteInputTokens: 0,
          outputTokens: 5_000,
          reasoningOutputTokens: 0,
          totalTokens: 85_000,
        },
        last: {
          inputTokens: 18_000,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 2_000,
          reasoningOutputTokens: 0,
          totalTokens: 20_000,
        },
        modelContextWindow: 100_000,
      },
    });

    await expect(client.getSessionStats()).resolves.toMatchObject({
      tokens: {
        input: 80_000,
        output: 5_000,
        cacheRead: 10_000,
        total: 85_000,
      },
      contextUsage: {
        tokens: 20_000,
        contextWindow: 100_000,
        percent: 20,
      },
    });
  });

  it("emits each question in a multi-question request", async () => {
    const client = new CodexRuntimeClient(
      { connectorId: "connector", transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    server.ask("question-2", "item/tool/requestUserInput", {
      questions: [
        {
          id: "first",
          header: "First",
          question: "Choose first",
          isOther: false,
          isSecret: false,
          options: [{ label: "A", description: "" }],
        },
        {
          id: "second",
          header: "Second",
          question: "Choose second",
          isOther: false,
          isSecret: false,
          options: [{ label: "B", description: "" }],
        },
      ],
    });
    client.respondToInteraction("codex:question-2", { value: "A" });
    expect(events.at(-1)).toMatchObject({
      type: "interaction_request",
      id: "codex:question-2",
      title: "Second",
      options: ["B"],
    });
    client.respondToInteraction("codex:question-2", { value: "B" });
    expect(server.responses.at(-1)).toEqual({
      id: "question-2",
      result: {
        answers: {
          first: { answers: ["A"] },
          second: { answers: ["B"] },
        },
      },
    });
  });
});
