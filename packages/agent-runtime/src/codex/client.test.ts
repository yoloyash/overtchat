import { beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({
  listCodexCustomPrompts: vi.fn(),
  materializeAgentImages: vi.fn(),
  startCodexAppServer: vi.fn(),
}));

vi.mock("./commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./commands")>()),
  listCodexCustomPrompts: mocks.listCodexCustomPrompts,
}));
vi.mock("@overtchat/agent-runtime/runtime/materialize-images", () => ({
  materializeAgentImages: mocks.materializeAgentImages,
}));

type Listener<T> = (value: T) => void;

function assistantParts(messages: unknown[]): Array<Record<string, unknown>> {
  return messages.flatMap((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      Reflect.get(message, "role") !== "assistant"
    ) {
      return [];
    }
    const content = Reflect.get(message, "content");
    return Array.isArray(content)
      ? content.filter(
          (part): part is Record<string, unknown> =>
            Boolean(part) && typeof part === "object",
        )
      : [];
  });
}

class FakeCodexServer {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  resumeError: Error | null = null;
  forkError: Error | null = null;
  compactError: Error | null = null;
  rateLimitsError: Error | null = null;
  usageError: Error | null = null;
  collaborationModes: unknown[] = [];
  goalSupported = false;
  goal: Record<string, unknown> | null = null;
  threadAccess: Record<string, unknown> = {};
  config: Record<string, unknown> | null = null;
  savedConfig: Record<string, unknown> | null = null;
  models: Record<string, unknown>[] | null = null;
  readonly threadReads = new Map<string, Record<string, unknown>>();
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
        data: this.models ?? [
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
    if (method === "collaborationMode/list") {
      return { data: this.collaborationModes };
    }
    if (method === "config/read") {
      return this.config ? { config: this.config } : {};
    }
    if (method === "getUserSavedConfig") {
      return this.savedConfig ? { config: this.savedConfig } : {};
    }
    if (method === "thread/goal/get") {
      if (!this.goalSupported) throw new Error("Method not found");
      return { goal: this.goal };
    }
    if (method === "thread/goal/set") {
      if (!this.goalSupported) throw new Error("Method not found");
      const input =
        params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : {};
      this.goal = {
        threadId: "thread-1",
        objective:
          typeof input.objective === "string"
            ? input.objective
            : typeof this.goal?.objective === "string"
              ? this.goal.objective
              : "Existing goal",
        status:
          typeof input.status === "string" ? input.status : "active",
        tokenBudget: null,
        tokensUsed: 12,
        timeUsedSeconds: 3,
        createdAt: 1,
        updatedAt: 2,
      };
      return { goal: this.goal };
    }
    if (method === "thread/goal/clear") {
      if (!this.goalSupported) throw new Error("Method not found");
      this.goal = null;
      return { cleared: true };
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
    if (method === "account/rateLimits/read") {
      if (this.rateLimitsError) throw this.rateLimitsError;
      return {
        rateLimits: {
          limitId: "codex",
          limitName: "Codex",
          planType: "plus",
          primary: {
            usedPercent: 25,
            windowDurationMins: 300,
            resetsAt: 1_786_300_000,
          },
          secondary: {
            usedPercent: 40,
            windowDurationMins: 10_080,
            resetsAt: 1_786_900_000,
          },
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: "12.50",
          },
        },
        rateLimitsByLimitId: null,
        rateLimitResetCredits: null,
      };
    }
    if (method === "account/usage/read") {
      if (this.usageError) throw this.usageError;
      return {
        summary: {
          lifetimeTokens: 1_234_567,
          currentStreakDays: 4,
          longestStreakDays: 12,
          peakDailyTokens: 345_678,
        },
        dailyUsageBuckets: null,
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
        ...this.threadAccess,
      };
    }
    if (method === "thread/fork") {
      if (this.forkError) throw this.forkError;
      const beforeTurnId =
        params &&
        typeof params === "object" &&
        "beforeTurnId" in params &&
        typeof params.beforeTurnId === "string"
          ? params.beforeTurnId
          : null;
      return {
        thread: {
          id: "thread-fork",
          cwd: "/workspace",
          preview: beforeTurnId ? "" : "Resume this thread",
          path: "/tmp/thread-fork.jsonl",
          name: null,
          createdAt: 3,
          updatedAt: 4,
          turns: beforeTurnId
            ? []
            : [
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
        model: "gpt-5.6",
        reasoningEffort: "high",
      };
    }
    if (method === "thread/compact/start" && this.compactError) {
      throw this.compactError;
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
      const threadId =
        params &&
        typeof params === "object" &&
        "threadId" in params &&
        typeof params.threadId === "string"
          ? params.threadId
          : "";
      const override = this.threadReads.get(threadId);
      if (override) return { thread: override };
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
                  id: "commentary-history",
                  type: "agentMessage",
                  phase: "commentary",
                  text: "I am restoring the native thread.",
                },
                {
                  id: "assistant-history",
                  type: "agentMessage",
                  phase: "final_answer",
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
  startCodexAppServer: (...args: unknown[]) =>
    mocks.startCodexAppServer(...args),
}));

import { CodexRuntimeClient } from "./client";

describe("CodexRuntimeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.requests.length = 0;
    server.responses.length = 0;
    server.resumeError = null;
    server.forkError = null;
    server.compactError = null;
    server.rateLimitsError = null;
    server.usageError = null;
    server.collaborationModes = [];
    server.goalSupported = false;
    server.goal = null;
    server.threadAccess = {};
    server.config = null;
    server.savedConfig = null;
    server.models = null;
    server.threadReads.clear();
    server.respondError.mockClear();
    mocks.startCodexAppServer.mockResolvedValue(server);
    mocks.materializeAgentImages.mockResolvedValue([]);
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
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );

    await expect(client.getCommands()).resolves.toEqual([
      {
        name: "fast",
        description: "Enable Fast mode",
        source: "builtin",
      },
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
    const inheritedTurn = server.requests.at(-1)?.params as Record<
      string,
      unknown
    >;
    expect(inheritedTurn).not.toHaveProperty("approvalPolicy");
    expect(inheritedTurn).not.toHaveProperty("sandboxPolicy");
    expect(inheritedTurn).not.toHaveProperty("approvalsReviewer");

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

  it("materializes images on the target host for prompts and steering", async () => {
    const target = {
      connectorId: "connector",
      transport: "ssh" as const,
      alias: "macbook",
    };
    const client = new CodexRuntimeClient(target, {
      executable: "codex",
      cwd: "/workspace",
    });
    const image = {
      uploadId: "11111111-1111-4111-8111-111111111111",
      filename: "screen.png",
      mediaType: "image/png" as const,
      data: "aW1hZ2U=",
    };
    mocks.materializeAgentImages.mockResolvedValue([
      "/tmp/overtchat-agent-images/screen.png",
    ]);

    await client.prompt("Inspect this", [image]);
    expect(mocks.materializeAgentImages).toHaveBeenCalledWith(target, [image]);
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        input: [
          {
            type: "text",
            text: "Inspect this",
            text_elements: [],
          },
          {
            type: "localImage",
            path: "/tmp/overtchat-agent-images/screen.png",
          },
        ],
      },
    });
    await expect(client.getMessages()).resolves.toEqual({
      messages: [
        expect.objectContaining({
          role: "user",
          content: [
            { type: "text", text: "Inspect this" },
            {
              type: "image",
              url: `/api/uploads/${image.uploadId}`,
              filename: "screen.png",
              mimeType: "image/png",
            },
          ],
        }),
      ],
    });

    await client.steer("", [image]);
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/steer",
      params: {
        expectedTurnId: "turn-1",
        input: [
          {
            type: "text",
            text: "",
            text_elements: [],
          },
          {
            type: "localImage",
            path: "/tmp/overtchat-agent-images/screen.png",
          },
        ],
      },
    });
  });

  it("starts new threads with the model from Codex saved configuration", async () => {
    server.savedConfig = { model: "gpt-5.6-saved" };
    server.config = { model: "gpt-5.6-config" };

    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();

    expect(server.requests.find((request) => request.method === "thread/start"))
      .toMatchObject({ params: { model: "gpt-5.6-saved" } });
  });

  it("uses model/list isDefault when Codex has no configured model", async () => {
    server.models = [
      { id: "first-model", displayName: "First" },
      { id: "default-model", displayName: "Default", isDefault: true },
    ];

    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();

    expect(server.requests.find((request) => request.method === "thread/start"))
      .toMatchObject({ params: { model: "default-model" } });
  });

  it.each([
    {
      source: "saved configuration",
      savedConfig: { model: "gpt-5.6", modelReasoningEffort: "xhigh" },
      config: { model_reasoning_effort: "high" },
      expected: "xhigh",
    },
    {
      source: "resolved configuration",
      savedConfig: null,
      config: { model: "gpt-5.6", model_reasoning_effort: "low" },
      expected: "low",
    },
  ])("preserves reasoning from Codex $source", async ({
    savedConfig,
    config,
    expected,
  }) => {
    server.savedConfig = savedConfig;
    server.config = config;

    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );

    await expect(client.getState()).resolves.toMatchObject({
      model: { provider: "codex", id: "gpt-5.6" },
      thinkingLevel: expected,
    });
    await expect(client.getAvailableThinkingLevels()).resolves.toContain(
      expected,
    );
    await client.prompt("Keep my configured reasoning");
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: { model: "gpt-5.6", effort: expected },
    });
  });

  it("switches to the selected model's default reasoning", async () => {
    server.models = [
      {
        id: "gpt-5.6",
        displayName: "GPT-5.6",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "high" },
        ],
        defaultReasoningEffort: "high",
      },
      {
        id: "gpt-5.6-mini",
        displayName: "GPT-5.6 Mini",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
        ],
        defaultReasoningEffort: "medium",
      },
    ];
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();

    await client.setModel("gpt-5.6-mini");
    await expect(client.getState()).resolves.toMatchObject({
      model: { provider: "codex", id: "gpt-5.6-mini" },
      thinkingLevel: "medium",
    });
    await client.prompt("Use the new model defaults");
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: { model: "gpt-5.6-mini", effort: "medium" },
    });
  });

  it("supports native goals, Code/Plan modes, Fast turns, and access modes", async () => {
    server.goalSupported = true;
    server.threadAccess = {
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: { type: "readOnly", networkAccess: false },
    };
    server.collaborationModes = [
      {
        name: "Code",
        mode: "default",
        model: null,
        reasoning_effort: null,
      },
      {
        name: "Plan",
        mode: "plan",
        model: null,
        reasoning_effort: null,
      },
    ];
    const client = new CodexRuntimeClient(
      { transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        detectedVersion: "0.147.0",
      },
    );

    await expect(client.getState()).resolves.toMatchObject({
      collaborationMode: "default",
      collaborationModes: ["default", "plan"],
      fastModeEnabled: false,
      fastModeAvailable: true,
      modeId: "auto",
      modes: [
        expect.objectContaining({ id: "auto", label: "Default Permissions" }),
        expect.objectContaining({ id: "auto-review", label: "Auto-review" }),
        expect.objectContaining({ id: "full-access", label: "Full Access" }),
      ],
      goalsSupported: true,
      goal: null,
    });
    expect(mocks.startCodexAppServer).toHaveBeenCalledWith(
      { transport: "local" },
      "codex",
      "/workspace",
      { enableGoals: true },
    );
    await expect(client.getCommands()).resolves.toContainEqual({
      name: "goal",
      description: "Set, pause, resume, or clear the agent goal",
      source: "builtin",
      argumentHint: "<objective>|pause|resume|clear",
    });
    await expect(client.getCommands()).resolves.toContainEqual({
      name: "plan",
      description: "Enable Plan mode",
      source: "builtin",
    });
    await expect(client.getCommands()).resolves.toContainEqual({
      name: "fast",
      description: "Enable Fast mode",
      source: "builtin",
    });

    await client.setCollaborationMode("plan");
    await client.setFastMode(true);
    await client.setMode("auto-review");
    await expect(client.getCommands()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "plan",
          description: "Disable Plan mode",
        }),
        expect.objectContaining({
          name: "fast",
          description: "Disable Fast mode",
        }),
      ]),
    );
    await client.prompt("Design the change");
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        serviceTier: "fast",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.6",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        },
      },
    });

    await client.setMode("full-access");
    await client.prompt("Apply the approved change");
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    });

    await client.setMode("auto");
    await client.prompt("Use default permissions again");
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: expect.objectContaining({ type: "workspaceWrite" }),
      },
    });

    await expect(
      client.updateGoal("set", "Ship the parity work"),
    ).resolves.toMatchObject({
      objective: "Ship the parity work",
      status: "active",
    });
    expect(server.requests).toContainEqual({
      method: "thread/goal/set",
      params: {
        threadId: "thread-1",
        objective: "Ship the parity work",
        status: "active",
      },
    });
    await client.updateGoal("pause");
    await expect(client.getState()).resolves.toMatchObject({
      goal: {
        objective: "Ship the parity work",
        status: "paused",
      },
    });
    await client.updateGoal("clear");
    await expect(client.getState()).resolves.toMatchObject({ goal: null });
  });

  it("only advertises Auto-review on supported Codex versions", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        detectedVersion: "0.114.0",
      },
    );

    await expect(client.getState()).resolves.toMatchObject({
      modes: [
        expect.objectContaining({ id: "auto" }),
        expect.objectContaining({ id: "full-access" }),
      ],
    });
    await expect(client.setMode("auto-review")).rejects.toThrow(
      "does not provide Auto-review",
    );
  });

  it("restores the effective access mode reported by Codex", async () => {
    server.threadAccess = {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: { type: "dangerFullAccess" },
    };
    const client = new CodexRuntimeClient(
      { transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        detectedVersion: "0.147.0",
      },
    );

    await expect(client.getState()).resolves.toMatchObject({
      modeId: "full-access",
    });
  });

  it("preserves Codex workspace-write configuration in Default Permissions", async () => {
    server.config = {
      approval_policy: "on-request",
      approvals_reviewer: "user",
      sandbox_mode: "workspace-write",
      sandbox_workspace_write: {
        writable_roots: ["/var/cache/npm"],
        network_access: true,
        exclude_tmpdir_env_var: false,
        exclude_slash_tmp: false,
      },
    };
    server.threadAccess = {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: { type: "dangerFullAccess" },
    };
    const client = new CodexRuntimeClient(
      { transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        detectedVersion: "0.147.0",
      },
    );

    await expect(client.getState()).resolves.toMatchObject({
      modeId: "full-access",
    });
    await client.setMode("auto");
    await client.prompt("Use my configured permissions");
    expect(server.requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/var/cache/npm"],
          networkAccess: true,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      },
    });
  });

  it("keeps plans, terminal input, and child activity after sparse completion", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();
    await client.prompt("Plan and implement");
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
      threadId: "child-1",
      turnId: "child-turn",
      item: {
        id: "child-message",
        type: "agentMessage",
        phase: "commentary",
        text: "Checking ",
      },
    });
    server.emit("item/agentMessage/delta", {
      threadId: "child-1",
      turnId: "child-turn",
      itemId: "child-message",
      delta: "the suite.",
    });
    server.emit("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "collab-1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        status: "inProgress",
        senderThreadId: "thread-1",
        receiverThreadIds: ["child-1"],
        prompt: "Inspect the tests",
        agentsStates: {
          "child-1": { status: "running", message: null },
        },
      },
    });
    server.emit("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "command-1",
        type: "commandExecution",
        command: "npm test",
        cwd: "/workspace",
        status: "inProgress",
        aggregatedOutput: "",
      },
    });
    server.emit("item/commandExecution/terminalInteraction", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "command-1",
      processId: "pty-1",
      stdin: "y\n",
    });
    server.emit("turn/plan/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      explanation: "Two focused steps.",
      plan: [
        { step: "Inspect the runtime", status: "completed" },
        { step: "Implement parity", status: "inProgress" },
      ],
    });
    server.emit("turn/completed", {
      threadId: "child-1",
      turn: {
        id: "child-turn",
        status: "completed",
        items: [],
      },
    });
    server.emit("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        startedAt: 10,
        completedAt: 12,
        items: [
          {
            id: "answer-1",
            type: "agentMessage",
            phase: "final_answer",
            text: "Ready.",
          },
        ],
      },
    });

    const messages = (await client.getMessages()).messages;
    expect(assistantParts(messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "subagent",
          prompt: "Inspect the tests",
          events: ["Checking the suite."],
        }),
        expect.objectContaining({
          type: "toolCall",
          id: "command-1",
          terminalInputs: ["y\n"],
        }),
        expect.objectContaining({
          type: "plan",
          explanation: "Two focused steps.",
        }),
        expect.objectContaining({ type: "text", text: "Ready." }),
      ]),
    );
    await expect(client.getState()).resolves.toMatchObject({
      isStreaming: false,
    });
  });

  it("ignores aggregate diff telemetry and keeps concrete file changes", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();
    server.emit("turn/started", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "inProgress",
        startedAt: 10,
        items: [],
      },
    });
    server.emit("turn/diff/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      diff: "--- a/runtime.ts\n+++ b/runtime.ts\n@@\n-old\n+new",
    });
    server.emit("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "edit-1",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "runtime.ts",
            kind: "update",
            diff: "@@\n-old\n+new",
          },
        ],
      },
    });

    const messages = (await client.getMessages()).messages;
    const assistant = messages.find(
      (message) =>
        message &&
        typeof message === "object" &&
        Reflect.get(message, "role") === "assistant",
    ) as { content: Array<Record<string, unknown>> };
    expect(assistant.content).toContainEqual(
      expect.objectContaining({
        type: "toolCall",
        id: "edit-1",
        name: "apply_patch",
      }),
    );
    expect(assistant.content).toHaveLength(1);
  });

  it("refreshes native skills when Codex reports a change", async () => {
    server.goalSupported = true;
    const client = new CodexRuntimeClient(
      { transport: "local" },
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
            expect.objectContaining({
              name: "goal",
              source: "builtin",
            }),
          ]),
        }),
      );
    });
  });

  it("starts a native thread and maps streamed activity", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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
          id: "command-1",
          role: "assistant",
          content: [
            expect.objectContaining({
              type: "toolCall",
              name: "bash",
            }),
          ],
        }),
        expect.objectContaining({
          id: "assistant-1",
          role: "assistant",
          content: [
            expect.objectContaining({
              type: "text",
              text: "Everything passes.",
            }),
          ],
        }),
        expect.objectContaining({
          role: "toolResult",
          toolCallId: "command-1",
          isError: false,
        }),
        expect.objectContaining({
          id: "turn-1:footer",
          role: "turnFooter",
          content: "Everything passes.",
          durationMs: 1_000,
        }),
      ]),
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn_start", turnId: "turn-1" }),
        expect.objectContaining({
          type: "overtchat_turn_update",
          turnId: "turn-1",
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: "Inspect the tests",
              overtchatTurnId: "turn-1",
            }),
          ]),
        }),
        expect.objectContaining({ type: "overtchat_turn_update" }),
        expect.objectContaining({ type: "turn_end", status: "completed" }),
      ]),
    );
  });

  it("reconciles the native Codex user item with its submitted identity", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();
    await client.prompt("Inspect the tests", [], {
      clientMessageId: "client-message",
    });
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
      item: {
        id: "provider-message",
        type: "userMessage",
        content: [
          {
            type: "text",
            text: "Inspect the tests",
            text_elements: [],
          },
        ],
      },
    });

    expect(
      (await client.getMessages()).messages.filter(
        (message) =>
          message &&
          typeof message === "object" &&
          Reflect.get(message, "role") === "user",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "turn-1:user:0",
        content: "Inspect the tests",
        overtchatSubmissionId: "client-message",
      }),
    ]);

    server.emit("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        startedAt: 10,
        completedAt: 11,
        items: [
          {
            id: "completed-provider-message",
            type: "userMessage",
            content: [
              {
                type: "text",
                text: "Inspect the tests",
                text_elements: [],
              },
            ],
          },
        ],
      },
    });

    const completedUsers = (await client.getMessages()).messages.filter(
      (message) =>
        message &&
        typeof message === "object" &&
        Reflect.get(message, "role") === "user",
    );
    expect(completedUsers).toHaveLength(1);
  });

  it("emits one authoritative ordered turn after a mid-turn steer", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();
    await client.prompt("write a paragraph on overtchat", [], {
      clientMessageId: "client-prompt",
    });
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
      item: {
        id: "assistant-1",
        type: "agentMessage",
        text: "First paragraph",
        phase: "final_answer",
      },
    });
    await client.steer("2 more now", [], {
      clientMessageId: "client-steer",
    });
    server.emit("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "provider-steer",
        type: "userMessage",
        content: [
          {
            type: "text",
            text: "2 more now",
            text_elements: [],
          },
        ],
      },
    });
    server.emit("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "assistant-2",
        type: "agentMessage",
        text: "Two more paragraphs",
        phase: "final_answer",
      },
    });

    const update = events.findLast(
      (event) => event.type === "overtchat_turn_update",
    );
    const messages = Array.isArray(update?.messages) ? update.messages : [];
    expect(
      messages.map((message) =>
        message && typeof message === "object"
          ? [
              Reflect.get(message, "role"),
              Reflect.get(message, "id"),
              Reflect.get(message, "overtchatTurnId"),
            ]
          : null,
      ),
    ).toEqual([
      ["user", "turn-1:user:0", "turn-1"],
      ["assistant", "assistant-1", "turn-1"],
      ["user", "turn-1:user:1", "turn-1"],
      ["assistant", "assistant-2", "turn-1"],
    ]);
  });

  it("preserves streamed work when the completed turn only includes the final answer", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();
    await client.prompt("Check the release");

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
      item: {
        id: "commentary-1",
        type: "agentMessage",
        phase: "commentary",
        text: "",
      },
    });
    server.emit("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "commentary-1",
      delta: "I'm checking the release image.",
    });
    server.emit("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "commentary-1",
        type: "agentMessage",
        phase: "commentary",
        text: "I'm checking the release image.",
      },
    });
    server.emit("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "command-1",
        type: "commandExecution",
        command: "docker build .",
        cwd: "/workspace",
        status: "completed",
        aggregatedOutput: "done\n",
        exitCode: 0,
      },
    });
    server.emit("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "commentary-2",
        type: "agentMessage",
        phase: "commentary",
        text: "The image built; I'm checking its contents.",
      },
    });
    server.emit("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "command-2",
        type: "commandExecution",
        command: "docker inspect image",
        cwd: "/workspace",
        status: "completed",
        aggregatedOutput: "healthy\n",
        exitCode: 0,
      },
    });
    server.emit("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "final-1",
        type: "agentMessage",
        phase: "final_answer",
        text: "",
      },
    });
    server.emit("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "final-1",
      delta: "The image is ready.",
    });
    server.emit("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        startedAt: 10,
        completedAt: 256,
        items: [
          {
            id: "final-1",
            type: "agentMessage",
            phase: "final_answer",
            text: "The image is ready.",
          },
        ],
      },
    });

    const { messages } = await client.getMessages();
    expect(assistantParts(messages)).toEqual([
      expect.objectContaining({
        id: "commentary-1",
        type: "text",
        phase: "commentary",
        text: "I'm checking the release image.",
      }),
      expect.objectContaining({
        type: "toolCall",
        id: "command-1",
        name: "bash",
      }),
      expect.objectContaining({
        id: "commentary-2",
        type: "text",
        phase: "commentary",
        text: "The image built; I'm checking its contents.",
      }),
      expect.objectContaining({
        type: "toolCall",
        id: "command-2",
        name: "bash",
      }),
      expect.objectContaining({
        id: "final-1",
        type: "text",
        text: "The image is ready.",
      }),
    ]);
    expect(messages).toContainEqual(
      expect.objectContaining({
        id: "turn-1:footer",
        role: "turnFooter",
        durationMs: 246_000,
        content:
          "I'm checking the release image.\n\nThe image built; I'm checking its contents.\n\nThe image is ready.",
      }),
    );
    expect(
      messages.filter(
        (message) =>
          message &&
          typeof message === "object" &&
          Reflect.get(message, "toolCallId") === "command-1",
      ),
    ).toHaveLength(1);
    expect(
      messages.filter(
        (message) =>
          message &&
          typeof message === "object" &&
          Reflect.get(message, "toolCallId") === "command-2",
      ),
    ).toHaveLength(1);
  });

  it("hydrates complete native history after resuming a thread", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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
          id: "turn-history:user:0",
          role: "user",
          content: "Resume this thread",
        }),
        expect.objectContaining({
          id: "commentary-history",
          role: "assistant",
          content: [
            expect.objectContaining({
              type: "text",
              phase: "commentary",
              text: "I am restoring the native thread.",
            }),
          ],
        }),
        expect.objectContaining({
          id: "assistant-history",
          role: "assistant",
          content: [
            expect.objectContaining({
              type: "text",
              text: "History restored.",
            }),
          ],
        }),
        expect.objectContaining({
          id: "turn-history:footer",
          role: "turnFooter",
          durationMs: 1_000,
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

  it("restores an active turn and appends steering input after its existing user message", async () => {
    server.threadReads.set("thread-1", {
      id: "thread-1",
      cwd: "/workspace",
      preview: "Original prompt",
      path: "/tmp/thread-1.jsonl",
      name: null,
      createdAt: 1,
      updatedAt: 2,
      turns: [
        {
          id: "turn-active",
          status: "inProgress",
          startedAt: 10,
          completedAt: null,
          items: [
            {
              id: "hydrated-provider-user",
              type: "userMessage",
              content: [
                {
                  type: "text",
                  text: "Original prompt",
                  text_elements: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const client = new CodexRuntimeClient(
      { transport: "local" },
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
      isStreaming: true,
    });
    await client.steer("Steering follow-up", [], {
      clientMessageId: "client-steer",
    });

    const users = (await client.getMessages()).messages.filter(
      (message) =>
        message &&
        typeof message === "object" &&
        Reflect.get(message, "role") === "user",
    );
    expect(users).toEqual([
      expect.objectContaining({
        id: "turn-active:user:0",
        content: "Original prompt",
      }),
      expect.objectContaining({
        id: "turn-active:user:1",
        content: "Steering follow-up",
        overtchatSubmissionId: "client-steer",
      }),
    ]);
  });

  it("rehydrates persisted subagent activity after resuming", async () => {
    server.threadReads.set("thread-1", {
      id: "thread-1",
      cwd: "/workspace",
      preview: "Delegate the audit",
      path: "/tmp/thread-1.jsonl",
      name: null,
      createdAt: 1,
      updatedAt: 2,
      turns: [
        {
          id: "turn-root",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          items: [
            {
              id: "collab-1",
              type: "collabAgentToolCall",
              tool: "spawnAgent",
              status: "completed",
              senderThreadId: "thread-1",
              receiverThreadIds: ["child-1"],
              prompt: "Inspect the tests",
              agentsStates: {
                "child-1": { status: "completed", message: "Tests are green" },
              },
            },
            {
              id: "answer-root",
              type: "agentMessage",
              phase: "final_answer",
              text: "The audit passed.",
            },
          ],
        },
      ],
    });
    server.threadReads.set("child-1", {
      id: "child-1",
      cwd: "/workspace",
      preview: "Inspect the tests",
      path: "/tmp/child-1.jsonl",
      name: null,
      createdAt: 1,
      updatedAt: 2,
      turns: [
        {
          id: "turn-child",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          items: [
            {
              id: "child-commentary",
              type: "agentMessage",
              phase: "commentary",
              text: "Checking the restored suite.",
            },
            {
              id: "child-command",
              type: "commandExecution",
              command: "npm test",
              cwd: "/workspace",
              status: "completed",
              aggregatedOutput: "491 passed",
            },
          ],
        },
      ],
    });
    const client = new CodexRuntimeClient(
      { transport: "local" },
      {
        executable: "codex",
        cwd: "/workspace",
        resume: {
          providerSessionId: "thread-1",
          providerSessionPath: "/tmp/thread-1.jsonl",
        },
      },
    );

    const messages = (await client.getMessages()).messages;
    const assistant = messages.find(
      (message) =>
        message &&
        typeof message === "object" &&
        Reflect.get(message, "role") === "assistant" &&
        Array.isArray(Reflect.get(message, "content")) &&
        Reflect.get(message, "content").some(
          (part: unknown) =>
            part &&
            typeof part === "object" &&
            Reflect.get(part, "type") === "subagent",
        ),
    ) as { content: Array<Record<string, unknown>> };
    expect(assistant.content).toContainEqual(
      expect.objectContaining({
        type: "subagent",
        events: [
          "Checking the restored suite.",
          "$ npm test\n491 passed",
        ],
      }),
    );
    expect(server.requests).toContainEqual({
      method: "thread/read",
      params: { threadId: "child-1", includeTurns: true },
    });
  });

  it("unsubscribes a resumed thread before stopping its app-server", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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
      { transport: "local" },
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
          id: "turn-history:user:0",
          content: "Resume this thread",
        }),
        expect.objectContaining({
          id: "assistant-history",
          role: "assistant",
        }),
        expect.objectContaining({
          id: "turn-history:footer",
          role: "turnFooter",
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
      { transport: "local" },
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
      { transport: "local" },
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

  it("acknowledges compaction start without waiting for the turn", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    await expect(client.compact()).resolves.toEqual({});
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
    await vi.waitFor(async () => {
      await expect(client.getState()).resolves.toMatchObject({
        isCompacting: false,
      });
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "compaction_start" }),
        expect.objectContaining({ type: "compaction_end" }),
      ]),
    );
  });

  it("ends the compaction lifecycle when the start request is rejected", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();
    server.compactError = new Error("Compaction is unavailable");

    await expect(client.compact()).rejects.toThrow("Compaction is unavailable");
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
      { transport: "local" },
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

  it("supports tool-scoped Codex user-input requests", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    await client.getState();

    server.ask("tool-question", "tool/requestUserInput", {
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
      id: "codex:tool-question",
      method: "select",
      options: ["A", "B"],
    });

    client.respondToInteraction("codex:tool-question", { value: "B" });
    expect(server.responses.at(-1)).toEqual({
      id: "tool-question",
      result: {
        answers: {
          choice: { answers: ["B"] },
        },
      },
    });
  });

  it("handles typed MCP elicitation forms and authorization URLs", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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
      { transport: "local" },
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

  it("reads account usage without starting a turn", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();

    await expect(client.getUsage()).resolves.toEqual({
      planType: "plus",
      windows: [
        {
          id: "codex:primary",
          label: "Codex",
          usedPercent: 25,
          resetsAt: 1_786_300_000,
          windowDurationMins: 300,
        },
        {
          id: "codex:secondary",
          label: "Codex",
          usedPercent: 40,
          resetsAt: 1_786_900_000,
          windowDurationMins: 10_080,
        },
      ],
      credits: { balance: "12.50", unlimited: false },
      activity: {
        lifetimeTokens: 1_234_567,
        currentStreakDays: 4,
        longestStreakDays: 12,
        peakDailyTokens: 345_678,
      },
      unavailableReason: null,
    });
    expect(server.requests).toContainEqual({
      method: "account/rateLimits/read",
      params: undefined,
    });
    expect(server.requests).toContainEqual({
      method: "account/usage/read",
      params: undefined,
    });
  });

  it("explains when account usage is unavailable", async () => {
    server.rateLimitsError = new Error(
      "codex account authentication required to read rate limits",
    );
    server.usageError = new Error(
      "codex account authentication required to read token usage",
    );
    const client = new CodexRuntimeClient(
      { transport: "local" },
      { executable: "codex", cwd: "/workspace" },
    );
    await client.getState();

    await expect(client.getUsage()).resolves.toEqual({
      planType: null,
      windows: [],
      credits: null,
      activity: null,
      unavailableReason:
        "Account usage is unavailable because this Codex connection does not expose authenticated account data.",
    });
  });

  it("edits the first user message by forking before its native turn", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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

    await expect(
      client.forkSession("turn-history:user:0", "edit"),
    ).resolves.toEqual({
      session: {
        providerSessionId: "thread-fork",
        providerSessionPath: "/tmp/thread-fork.jsonl",
        name: null,
        firstMessage: null,
        messageCount: 0,
        createdAt: new Date(3_000),
        modifiedAt: new Date(4_000),
      },
      draft: "Resume this thread",
      replacesCurrentSession: true,
    });
    expect(server.requests).toContainEqual({
      method: "thread/fork",
      params: {
        threadId: "thread-1",
        beforeTurnId: "turn-history",
        cwd: "/workspace",
        model: "gpt-5.6",
        ephemeral: false,
      },
    });
    expect(server.requests).toContainEqual({
      method: "thread/unsubscribe",
      params: { threadId: "thread-1" },
    });
    await expect(client.getState()).resolves.toMatchObject({
      sessionId: "thread-fork",
      sessionFile: "/tmp/thread-fork.jsonl",
    });
    await expect(client.getMessages()).resolves.toEqual({ messages: [] });

    await client.prompt("Replace the first message");
    expect(server.requests).toContainEqual({
      method: "turn/start",
      params: expect.objectContaining({
        threadId: "thread-fork",
        input: [
          {
            type: "text",
            text: "Replace the first message",
            text_elements: [],
          },
        ],
      }),
    });
  });

  it("deletes a discarded native fork", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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

    await client.discardForkedSession({
      providerSessionId: "thread-fork",
      providerSessionPath: "/tmp/thread-fork.jsonl",
      name: null,
      firstMessage: null,
      messageCount: 0,
      createdAt: new Date(3_000),
      modifiedAt: new Date(4_000),
    });

    expect(server.requests).toContainEqual({
      method: "thread/delete",
      params: { threadId: "thread-fork" },
    });
  });

  it("forks through an assistant turn without mutating the source", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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

    await expect(
      client.forkSession("turn-history:assistant", "fork"),
    ).resolves.toMatchObject({
      session: {
        providerSessionId: "thread-fork",
        providerSessionPath: "/tmp/thread-fork.jsonl",
        firstMessage: "Resume this thread",
        messageCount: 2,
      },
    });
    expect(server.requests).toContainEqual({
      method: "thread/fork",
      params: {
        threadId: "thread-1",
        lastTurnId: "turn-history",
        cwd: "/workspace",
        model: "gpt-5.6",
        ephemeral: false,
      },
    });
    expect(server.requests).toContainEqual({
      method: "thread/unsubscribe",
      params: { threadId: "thread-fork" },
    });
    await expect(client.getMessages()).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "turn-history:user:0", role: "user" }),
        expect.objectContaining({
          id: "commentary-history",
          role: "assistant",
        }),
        expect.objectContaining({
          id: "assistant-history",
          role: "assistant",
        }),
        expect.objectContaining({
          id: "turn-history:footer",
          role: "turnFooter",
        }),
      ]),
    });
  });

  it("explains when first-message editing needs newer Codex support", async () => {
    server.forkError = new Error("unknown field `beforeTurnId`");
    const client = new CodexRuntimeClient(
      { transport: "local" },
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

    await expect(
      client.forkSession("turn-history:user:0", "edit"),
    ).rejects.toThrow(
      "Editing the first message requires a newer Codex installation.",
    );
  });

  it("emits each question in a multi-question request", async () => {
    const client = new CodexRuntimeClient(
      { transport: "local" },
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
