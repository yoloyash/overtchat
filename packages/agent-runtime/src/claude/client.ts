import { randomUUID } from "node:crypto";
import {
  query as createSdkQuery,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentInteractionValue,
  AgentMode,
  AgentModel,
  AgentSessionStats,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import type {
  AgentRuntimeClient,
  AgentRuntimeEvent,
  AgentSessionLaunch,
  AgentSubmissionOptions,
  ResolvedAgentImage,
} from "@overtchat/agent-runtime/providers/types";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";
import {
  claudeModesForModels,
  isClaudePermissionMode,
  parseClaudeModels,
  readClaudeSettingsModels,
} from "@overtchat/agent-runtime/claude/models";
import { spawnClaudeOnHost } from "@overtchat/agent-runtime/claude/process";
import {
  readClaudeSessionMessages,
  renameClaudeSession,
} from "@overtchat/agent-runtime/claude/sessions";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class ClaudeInputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly values: SDKUserMessage[] = [];
  private readonly waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  push(value: SDKUserMessage): void {
    if (this.closed) throw new Error("Claude input is closed.");
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

type PendingInteraction = {
  kind: "permission" | "question";
  resolve(value: PermissionResult): void;
  suggestions?: PermissionUpdate[];
  input: Record<string, unknown>;
  questions?: ClaudeQuestion[];
  toolName: string;
};

type ClaudeQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
};

type AssistantProjection = {
  role: "assistant";
  id: string;
  content: Array<Record<string, unknown>>;
  timestamp: number;
  errorMessage?: string;
};

const EMPTY_STATS: AgentSessionStats = {
  sessionFile: null,
  sessionId: null,
  userMessages: 0,
  assistantMessages: 0,
  toolCalls: 0,
  toolResults: 0,
  totalMessages: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandRows(commands: readonly SlashCommand[]): AgentSlashCommand[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description || undefined,
    argumentHint: command.argumentHint || undefined,
    source: "custom",
  }));
}

function interactionToolDetail(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === "Bash" && typeof input.command === "string") {
    return { type: "shell", command: input.command };
  }
  const filePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : undefined;
  if (toolName === "Write" && filePath && typeof input.content === "string") {
    return { type: "write", filePath, content: input.content };
  }
  if ((toolName === "Edit" || toolName === "NotebookEdit") && filePath) {
    return { type: "edit", filePath };
  }
  return { type: "json", value: input };
}

function questionsFromInput(input: Record<string, unknown>): ClaudeQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.flatMap((candidate) => {
    const question = record(candidate);
    if (!question || typeof question.question !== "string") return [];
    const options = Array.isArray(question.options)
      ? question.options.flatMap((candidateOption) => {
          const option = record(candidateOption);
          return option && typeof option.label === "string"
            ? [{
                label: option.label,
                ...(typeof option.description === "string"
                  ? { description: option.description }
                  : {}),
              }]
            : [];
        })
      : [];
    return [{
      question: question.question,
      ...(typeof question.header === "string" ? { header: question.header } : {}),
      ...(question.multiSelect === true ? { multiSelect: true } : {}),
      ...(options.length ? { options } : {}),
    }];
  });
}

function questionFields(questions: readonly ClaudeQuestion[]) {
  return questions.map((question, index) => ({
    id: String(index),
    label: question.header || `Question ${index + 1}`,
    description: question.question,
    type: question.multiSelect
      ? ("multiselect" as const)
      : question.options?.length
        ? ("select" as const)
        : ("text" as const),
    required: true,
    secret: false,
    options: (question.options ?? []).map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
  }));
}

function safeEnvironment(): Record<string, string | undefined> {
  // The connector's local child already inherits process.env, while an SSH
  // child inherits the remote login environment. Sending the connector's full
  // environment as command prefixes would both override remote credentials
  // and expose local secrets in process arguments.
  return {
    CLAUDE_AGENT_SDK_CLIENT_APP: "overtchat/0.11.0",
    TERM: "dumb",
    NO_COLOR: "1",
  };
}

function thinkingOptions(level: string | undefined) {
  if (level === "off") return { thinking: { type: "disabled" as const } };
  if (["low", "medium", "high", "xhigh", "max"].includes(level ?? "")) {
    return {
      thinking: { type: "adaptive" as const },
      effort: level as "low" | "medium" | "high" | "xhigh" | "max",
    };
  }
  return {};
}

export class ClaudeRuntimeClient implements AgentRuntimeClient {
  private readonly subscribers = new Set<(event: AgentRuntimeEvent) => void>();
  private readonly pendingInteractions = new Map<string, PendingInteraction>();
  private readonly assistantMessages = new Map<string, AssistantProjection>();
  private readonly toolNames = new Map<string, string>();
  private input = new ClaudeInputQueue();
  private sdkQuery!: Query;
  private consumeGeneration = 0;
  private consumePromise: Promise<void> = Promise.resolve();
  private lifecycleTail: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private sessionId?: string;
  private sessionName: string | null = null;
  private models: AgentModel[] = [];
  private modes: AgentMode[] = [];
  private commands: AgentSlashCommand[] = [];
  private messages: unknown[] = [];
  private stats: AgentSessionStats = EMPTY_STATS;
  private selectedModel?: string;
  private thinkingOptionId?: string;
  private modeId: PermissionMode;
  private active = false;
  private compacting = false;
  private stopped = false;
  private restarting = false;
  private recentStderr = "";
  private currentStreamMessageId?: string;

  constructor(
    private readonly target: HostTarget,
    private readonly launch: AgentSessionLaunch,
  ) {
    this.sessionId = launch.resume?.providerSessionId ?? randomUUID();
    this.selectedModel = launch.model;
    this.thinkingOptionId = launch.thinkingOptionId;
    this.modeId = isClaudePermissionMode(launch.modeId ?? "")
      ? launch.modeId as PermissionMode
      : "auto";
    this.startQuery(launch.resume?.providerSessionId);
    this.readyPromise = this.initialize();
    void this.readyPromise.catch(() => {});
  }

  onEvent(subscriber: (event: AgentRuntimeEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async getState(): Promise<Record<string, unknown>> {
    await this.readyPromise;
    return {
      sessionId: this.sessionId,
      sessionFile: this.launch.resume?.providerSessionPath ?? this.sessionId,
      sessionName: this.sessionName,
      model: this.selectedModel
        ? { provider: "claude", id: this.selectedModel }
        : null,
      thinkingLevel: this.thinkingOptionId ?? "high",
      modeId: this.modeId,
      modes: this.modes,
      isStreaming: this.active,
      isCompacting: this.compacting,
    };
  }

  async getMessages(): Promise<{ messages: unknown[] }> {
    await this.readyPromise;
    return { messages: [...this.messages] };
  }

  async getAvailableModels(): Promise<AgentModel[]> {
    await this.readyPromise;
    return this.models;
  }

  async getSessionStats(): Promise<AgentSessionStats> {
    await this.readyPromise;
    const counts = this.messages.reduce<{
      userMessages: number;
      assistantMessages: number;
      toolCalls: number;
      toolResults: number;
    }>(
      (current, message) => {
        const value = record(message);
        const role = value?.role;
        if (role === "user") current.userMessages += 1;
        if (role === "assistant") {
          current.assistantMessages += 1;
          const content = Array.isArray(value?.content) ? value.content : [];
          current.toolCalls += content.filter(
            (part) => record(part)?.type === "toolCall",
          ).length;
        }
        if (role === "toolResult") current.toolResults += 1;
        return current;
      },
      { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0 },
    );
    return {
      ...this.stats,
      ...counts,
      sessionFile: this.launch.resume?.providerSessionPath ?? this.sessionId ?? null,
      sessionId: this.sessionId ?? null,
      totalMessages: this.messages.length,
    };
  }

  async getCommands(): Promise<AgentSlashCommand[]> {
    await this.readyPromise;
    return this.commands;
  }

  async prompt(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    return this.withLifecycle(async () => {
      await this.readyPromise;
      return this.submit(message, images, options, false);
    });
  }

  async steer(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    return this.withLifecycle(async () => {
      await this.readyPromise;
      return this.submit(message, images, options, true);
    });
  }

  async abort(): Promise<unknown> {
    return this.withLifecycle(async () => {
      await this.readyPromise;
      this.cancelInteractions(new Error("Claude interaction was cancelled."));
      const result = await this.sdkQuery.interrupt();
      await this.restartQuery();
      return result;
    });
  }

  async setModel(modelId: string): Promise<unknown> {
    return this.withLifecycle(async () => {
      await this.readyPromise;
      if (!this.models.some((model) => model.id === modelId)) {
        throw new Error(`Claude Code did not report model ${modelId}.`);
      }
      await this.sdkQuery.setModel(modelId);
      this.selectedModel = modelId;
      this.emitConfig();
      return undefined;
    });
  }

  async setThinkingLevel(level: string): Promise<unknown> {
    return this.withLifecycle(async () => {
      await this.readyPromise;
      const model = this.models.find((candidate) => candidate.id === this.selectedModel);
      if (!model?.thinkingOptions?.some((option) => option.id === level)) {
        throw new Error(`Claude model ${this.selectedModel ?? "selection"} does not provide thinking level ${level}.`);
      }
      this.thinkingOptionId = level;
      await this.restartQuery();
      this.emitConfig();
      return undefined;
    });
  }

  async setMode(modeId: string): Promise<unknown> {
    return this.withLifecycle(async () => {
      await this.readyPromise;
      if (!isClaudePermissionMode(modeId) || !this.modes.some((mode) => mode.id === modeId)) {
        throw new Error(`Claude Code does not provide permission mode ${modeId}.`);
      }
      await this.sdkQuery.setPermissionMode(modeId);
      this.modeId = modeId;
      this.emitConfig();
      return undefined;
    });
  }

  async compact(customInstructions?: string): Promise<unknown> {
    if (customInstructions) {
      throw new Error("Claude Code does not accept custom compaction instructions.");
    }
    return this.withLifecycle(async () => {
      await this.readyPromise;
      this.compacting = true;
      this.emit({ type: "compaction_start" });
      return this.submit("/compact", [], {}, false);
    });
  }

  setAutoCompaction(): Promise<unknown> {
    return Promise.reject(
      new Error("Claude Code manages context compaction automatically."),
    );
  }

  async setSessionName(name: string): Promise<unknown> {
    return this.withLifecycle(async () => {
      await this.readyPromise;
      await renameClaudeSession(
        this.target,
        this.launch.resume?.providerSessionPath ?? this.sessionId!,
        this.sessionId!,
        name,
      );
      this.sessionName = name;
      this.emit({ type: "session_info_update", title: name });
      return undefined;
    });
  }

  respondToInteraction(
    id: string,
    response: {
      value?: string;
      values?: Record<string, AgentInteractionValue>;
      confirmed?: boolean;
      cancelled?: boolean;
    },
  ): void {
    const pending = this.pendingInteractions.get(id);
    if (!pending) return;
    this.pendingInteractions.delete(id);
    this.emit({ type: "interaction_resolved", id });
    if (pending.kind === "question") {
      if (response.cancelled) {
        pending.resolve({
          behavior: "deny",
          message: "The user cancelled the question.",
          decisionClassification: "user_reject",
        });
        return;
      }
      const answers = Object.fromEntries(
        (pending.questions ?? []).map((question, index) => {
          const value = response.values?.[String(index)];
          return [
            question.question,
            Array.isArray(value) ? value.join(", ") : String(value ?? ""),
          ];
        }),
      );
      pending.resolve({
        behavior: "allow",
        updatedInput: { ...pending.input, answers },
        decisionClassification: "user_temporary",
      });
      return;
    }
    const allow =
      !response.cancelled &&
      (response.confirmed === true ||
        response.value === "Allow once" ||
        response.value === "Allow always");
    if (!allow) {
      pending.resolve({
        behavior: "deny",
        message: "The user denied this action.",
        decisionClassification: "user_reject",
      });
      return;
    }
    const always = response.value === "Allow always";
    if (pending.toolName === "ExitPlanMode") {
      this.modeId = "acceptEdits";
      void this.sdkQuery.setPermissionMode("acceptEdits").catch(() => {});
      this.emitConfig();
    }
    pending.resolve({
      behavior: "allow",
      updatedInput: pending.input,
      ...(always && pending.suggestions?.length
        ? { updatedPermissions: pending.suggestions }
        : {}),
      decisionClassification: always ? "user_permanent" : "user_temporary",
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelInteractions(new Error("Claude session stopped."));
    this.input.close();
    this.sdkQuery.close();
    await this.consumePromise.catch(() => {});
  }

  private async initialize(): Promise<void> {
    const [initialized, settingsModels] = await Promise.all([
      this.sdkQuery.initializationResult(),
      readClaudeSettingsModels(this.target),
    ]);
    const models = initialized.models;
    const commands = initialized.commands;
    this.models = parseClaudeModels(models, settingsModels);
    if (!this.models.length) {
      throw new Error("Claude Code did not report any usable models.");
    }
    this.commands = commandRows(commands);
    this.modes = claudeModesForModels(models);
    if (!this.modes.some((mode) => mode.id === this.modeId)) {
      this.modeId = "default";
      await this.sdkQuery.setPermissionMode(this.modeId);
    }
    this.selectedModel ??= this.models.find((model) => model.isDefault)?.id ?? this.models[0]?.id;
    this.thinkingOptionId ??= this.models.find((model) => model.id === this.selectedModel)?.defaultThinkingOptionId;
    if (this.launch.resume?.providerSessionPath) {
      this.messages = await readClaudeSessionMessages(
        this.target,
        this.launch.resume.providerSessionPath,
      );
    }
  }

  private startQuery(resume?: string): void {
    const generation = ++this.consumeGeneration;
    this.input = new ClaudeInputQueue();
    this.sdkQuery = createSdkQuery({
      prompt: this.input,
      options: {
        cwd: this.launch.cwd,
        env: safeEnvironment(),
        pathToClaudeCodeExecutable: this.launch.executable,
        ...(resume ? { resume } : { sessionId: this.sessionId }),
        ...(this.selectedModel ? { model: this.selectedModel } : {}),
        ...thinkingOptions(this.thinkingOptionId),
        includePartialMessages: true,
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        permissionMode: this.modeId,
        allowDangerouslySkipPermissions: true,
        canUseTool: this.canUseTool,
        stderr: (data) => this.captureStderr(data),
        spawnClaudeCodeProcess: (options) =>
          spawnClaudeOnHost(this.target, options, (data) => this.captureStderr(data)),
      },
    });
    this.consumePromise = this.consume(this.sdkQuery, generation);
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    const pending = deferred<PermissionResult>();
    const questions = toolName === "AskUserQuestion" ? questionsFromInput(input) : [];
    const id = `claude:${questions.length ? "question" : "permission"}:${options.requestId}`;
    this.pendingInteractions.set(id, {
      kind: questions.length ? "question" : "permission",
      resolve: pending.resolve,
      suggestions: options.suggestions,
      input,
      questions,
      toolName,
    });
    if (questions.length) {
      this.emit({
        type: "interaction_request",
        id,
        method: "form",
        title: questions.length === 1
          ? questions[0]?.header ?? "Claude needs your input"
          : "Claude needs your input",
        message: questions.length === 1
          ? questions[0]?.question
          : "Answer the following questions to continue.",
        fields: questionFields(questions),
      });
    } else {
      const title = options.title || `Allow ${options.displayName || toolName}?`;
      this.emit({
        type: "interaction_request",
        id,
        method: "select",
        title,
        message: options.description || options.decisionReason || "Claude needs permission to continue.",
        options: ["Allow once", "Allow always", "Deny"],
        approvalKind: "tool",
        toolName,
        toolDetail: interactionToolDetail(toolName, input),
        approveValue: "Allow once",
        alwaysValue: "Allow always",
        denyValue: "Deny",
      });
    }
    const abort = () => {
      if (!this.pendingInteractions.delete(id)) return;
      this.emit({ type: "interaction_resolved", id });
      pending.resolve({
        behavior: "deny",
        message: "The action was cancelled.",
        interrupt: true,
      });
    };
    options.signal.addEventListener("abort", abort, { once: true });
    try {
      return await pending.promise;
    } finally {
      options.signal.removeEventListener("abort", abort);
    }
  };

  private async submit(
    message: string,
    images: readonly ResolvedAgentImage[],
    options: AgentSubmissionOptions,
    steering: boolean,
  ): Promise<void> {
    if (this.stopped) throw new Error("Claude session is stopped.");
    const content = images.length
      ? [
          { type: "text", text: message },
          ...images.map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: image.data,
            },
          })),
        ]
      : message;
    const user = {
      role: "user",
      id: randomUUID(),
      content: [
        ...(message ? [{ type: "text", text: message }] : []),
        ...images.map((image) => ({
          type: "image",
          url: `/api/uploads/${image.uploadId}`,
          mimeType: image.mediaType,
          filename: image.filename,
        })),
      ],
      timestamp: Date.now(),
      ...(options.clientMessageId
        ? { overtchatSubmissionId: options.clientMessageId }
        : {}),
    };
    this.messages.push(user);
    this.emit({ type: "message_end", message: user });
    if (!this.active) {
      this.active = true;
      this.emit({ type: "turn_start" });
    }
    this.input.push({
      type: "user",
      message: { role: "user", content } as SDKUserMessage["message"],
      parent_tool_use_id: null,
      uuid: randomUUID(),
      origin: { kind: "human" },
      ...(steering ? { priority: "next" as const } : {}),
    });
  }

  private async restartQuery(): Promise<void> {
    if (this.stopped) return;
    this.restarting = true;
    const oldInput = this.input;
    const oldQuery = this.sdkQuery;
    oldInput.close();
    oldQuery.close();
    await this.consumePromise.catch(() => {});
    this.restarting = false;
    this.active = false;
    this.compacting = false;
    if (this.stopped) return;
    this.startQuery(this.sessionId);
    const [initialized, settingsModels] = await Promise.all([
      this.sdkQuery.initializationResult(),
      readClaudeSettingsModels(this.target),
    ]);
    const models = initialized.models;
    const commands = initialized.commands;
    this.models = parseClaudeModels(models, settingsModels);
    this.modes = claudeModesForModels(models);
    this.commands = commandRows(commands);
  }

  private async consume(query: Query, generation: number): Promise<void> {
    try {
      for await (const message of query) {
        if (generation !== this.consumeGeneration) return;
        this.handleMessage(message);
      }
      if (!this.stopped && !this.restarting && generation === this.consumeGeneration) {
        throw new Error("Claude Code exited unexpectedly.");
      }
    } catch (error) {
      if (this.stopped || this.restarting || generation !== this.consumeGeneration) return;
      const detail = this.recentStderr.trim();
      const message = `${errorText(error)}${detail ? `\n${detail}` : ""}`;
      this.emit({ type: "rpc_error", error: message });
      this.emit({ type: "process_exit", error: message });
    }
  }

  private handleMessage(message: SDKMessage): void {
    if (message.type === "system") {
      this.handleSystem(message as SDKMessage & Record<string, unknown>);
      return;
    }
    if (message.type === "stream_event") {
      this.handleStream(message as SDKMessage & Record<string, unknown>);
      return;
    }
    if (message.type === "assistant") {
      this.handleAssistant(message as SDKMessage & Record<string, unknown>);
      return;
    }
    if (message.type === "user") {
      this.handleUser(message as SDKMessage & Record<string, unknown>);
      return;
    }
    if (message.type === "result") {
      this.handleResult(message as SDKMessage & Record<string, unknown>);
    }
  }

  private handleSystem(message: SDKMessage & Record<string, unknown>): void {
    const subtype = message.subtype;
    if (subtype === "init") {
      this.sessionId = String(message.session_id);
      if (typeof message.model === "string") this.selectedModel = message.model;
      if (isClaudePermissionMode(String(message.permissionMode ?? ""))) {
        this.modeId = message.permissionMode as PermissionMode;
      }
      if (Array.isArray(message.slash_commands)) {
        this.commands = message.slash_commands.flatMap((name) =>
          typeof name === "string"
            ? [{ name: name.replace(/^\//u, ""), source: "custom" as const }]
            : [],
        );
        this.emit({ type: "available_commands_update", commands: this.commands });
      }
      this.emitConfig();
      return;
    }
    if (subtype === "commands_changed" && Array.isArray(message.commands)) {
      this.commands = commandRows(message.commands as SlashCommand[]);
      this.emit({ type: "available_commands_update", commands: this.commands });
      return;
    }
    if (subtype === "session_state_changed") {
      if (message.state === "running" && !this.active) {
        this.active = true;
        this.emit({ type: "turn_start" });
      } else if (message.state === "idle") {
        this.finishTurn();
      }
      return;
    }
    if (subtype === "status") {
      if (message.status === "compacting" && !this.compacting) {
        this.compacting = true;
        this.emit({ type: "compaction_start" });
      } else if (message.status === null && this.compacting) {
        this.compacting = false;
        this.emit({
          type: "compaction_end",
          ...(typeof message.compact_error === "string"
            ? { error: message.compact_error }
            : {}),
        });
      }
      return;
    }
    if (subtype === "compact_boundary") {
      if (this.compacting) {
        this.compacting = false;
        this.emit({ type: "compaction_end" });
      }
    }
  }

  private handleStream(message: SDKMessage & Record<string, unknown>): void {
    const event = record(message.event);
    if (!event) return;
    if (event.type === "message_start") {
      const native = record(event.message);
      if (typeof native?.id === "string") {
        this.currentStreamMessageId = native.id;
        this.ensureAssistant(native.id);
      }
      return;
    }
    const messageId = this.currentStreamMessageId;
    if (!messageId) return;
    const index = typeof event.index === "number" ? event.index : 0;
    if (event.type === "content_block_start") {
      const block = record(event.content_block);
      if (block) this.mergeAssistantBlock(messageId, block, index);
      return;
    }
    if (event.type === "content_block_delta") {
      const delta = record(event.delta);
      if (!delta) return;
      const projection = this.ensureAssistant(messageId);
      const part = projection.content[index];
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        projection.content[index] = {
          type: "text",
          text: `${typeof part?.text === "string" ? part.text : ""}${delta.text}`,
        };
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        projection.content[index] = {
          type: "thinking",
          thinking: `${typeof part?.thinking === "string" ? part.thinking : ""}${delta.thinking}`,
        };
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        projection.content[index] = {
          ...(part ?? { type: "toolCall", id: `tool-${index}`, name: "tool" }),
          overtchatPartialArguments: `${typeof part?.overtchatPartialArguments === "string" ? part.overtchatPartialArguments : ""}${delta.partial_json}`,
        };
      }
      this.publishAssistant(projection, "message_update");
    }
  }

  private handleAssistant(message: SDKMessage & Record<string, unknown>): void {
    const native = record(message.message);
    if (!native || typeof native.id !== "string") return;
    const projection = this.ensureAssistant(native.id);
    if (typeof message.error === "string") projection.errorMessage = message.error;
    const content = Array.isArray(native.content) ? native.content : [];
    for (const [index, block] of content.entries()) {
      const value = record(block);
      if (value) this.mergeAssistantBlock(native.id, value, index);
    }
    this.publishAssistant(projection, "message_end");
    if (this.currentStreamMessageId === native.id) {
      this.currentStreamMessageId = undefined;
    }
  }

  private mergeAssistantBlock(
    messageId: string,
    block: Record<string, unknown>,
    index: number,
  ): void {
    const projection = this.ensureAssistant(messageId);
    const matchingIndex = projection.content.findIndex((candidate) => {
      if (block.type === "tool_use") return candidate.id === block.id;
      if (block.type === "text") return candidate.type === "text";
      if (block.type === "thinking") return candidate.type === "thinking";
      return false;
    });
    const destination = matchingIndex >= 0
      ? matchingIndex
      : projection.content[index] === undefined
        ? index
        : projection.content.length;
    if (block.type === "text" && typeof block.text === "string") {
      projection.content[destination] = { type: "text", text: block.text };
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      projection.content[destination] = { type: "thinking", thinking: block.thinking };
    } else if (block.type === "tool_use" && typeof block.id === "string") {
      const name = typeof block.name === "string" ? block.name : "tool";
      this.toolNames.set(block.id, name);
      projection.content[destination] = {
        type: "toolCall",
        id: block.id,
        name,
        arguments: record(block.input) ?? block.input ?? {},
      };
    }
  }

  private handleUser(message: SDKMessage & Record<string, unknown>): void {
    const native = record(message.message);
    if (!native || !Array.isArray(native.content)) return;
    for (const blockValue of native.content) {
      const block = record(blockValue);
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const content = typeof block.content === "string"
        ? [{ type: "text", text: block.content }]
        : Array.isArray(block.content)
          ? block.content
          : [{ type: "text", text: JSON.stringify(block.content ?? "") }];
      const toolName = this.toolNames.get(block.tool_use_id) ?? "Claude tool";
      const normalized = {
        role: "toolResult",
        toolCallId: block.tool_use_id,
        toolName,
        content,
        isError: block.is_error === true,
        timestamp: Date.now(),
      };
      this.messages.push(normalized);
      this.emit({
        type: "tool_execution_end",
        toolCallId: block.tool_use_id,
        toolName,
        result: { content },
        isError: block.is_error === true,
      });
    }
  }

  private handleResult(message: SDKMessage & Record<string, unknown>): void {
    const usage = record(message.usage);
    const modelUsage = record(message.modelUsage);
    const totals = modelUsage
      ? Object.values(modelUsage).reduce<{
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
        }>(
          (current, candidate) => {
            const value = record(candidate);
            current.input += Number(value?.inputTokens ?? 0);
            current.output += Number(value?.outputTokens ?? 0);
            current.cacheRead += Number(value?.cacheReadInputTokens ?? 0);
            current.cacheWrite += Number(value?.cacheCreationInputTokens ?? 0);
            return current;
          },
          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        )
      : {
          input: Number(usage?.input_tokens ?? 0),
          output: Number(usage?.output_tokens ?? 0),
          cacheRead: Number(usage?.cache_read_input_tokens ?? 0),
          cacheWrite: Number(usage?.cache_creation_input_tokens ?? 0),
        };
    this.stats = {
      ...this.stats,
      tokens: {
        ...totals,
        total: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
      },
      cost: typeof message.total_cost_usd === "number" ? message.total_cost_usd : 0,
    };
    if (message.is_error === true) {
      const errors = Array.isArray(message.errors)
        ? message.errors.filter((value): value is string => typeof value === "string")
        : [];
      this.emit({
        type: "rpc_error",
        error: errors.join("\n") || String(message.result ?? "Claude Code turn failed."),
      });
    }
    this.finishTurn();
  }

  private ensureAssistant(id: string): AssistantProjection {
    const current = this.assistantMessages.get(id);
    if (current) return current;
    const projection: AssistantProjection = {
      role: "assistant",
      id,
      content: [],
      timestamp: Date.now(),
    };
    this.assistantMessages.set(id, projection);
    this.messages.push(projection);
    this.emit({ type: "message_start", message: projection });
    return projection;
  }

  private publishAssistant(
    projection: AssistantProjection,
    type: "message_update" | "message_end",
  ): void {
    this.emit({ type, message: { ...projection, content: [...projection.content] } });
  }

  private finishTurn(): void {
    if (this.currentStreamMessageId) {
      const projection = this.assistantMessages.get(this.currentStreamMessageId);
      if (projection) this.publishAssistant(projection, "message_end");
      this.currentStreamMessageId = undefined;
    }
    if (!this.active) return;
    this.active = false;
    this.emit({ type: "turn_end" });
  }

  private emitConfig(): void {
    this.emit({
      type: "config_update",
      model: this.selectedModel ? { provider: "claude", id: this.selectedModel } : null,
      thinkingLevel: this.thinkingOptionId ?? "high",
      modeId: this.modeId,
      modes: this.modes,
    });
  }

  private cancelInteractions(error: Error): void {
    for (const [id, pending] of this.pendingInteractions) {
      pending.resolve({
        behavior: "deny",
        message: error.message,
        interrupt: true,
      });
      this.emit({ type: "interaction_resolved", id });
    }
    this.pendingInteractions.clear();
  }

  private captureStderr(data: string): void {
    this.recentStderr = `${this.recentStderr}${data}`.slice(-16_000);
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private withLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function startClaudeRuntime(
  target: HostTarget,
  launch: AgentSessionLaunch,
): ClaudeRuntimeClient {
  return new ClaudeRuntimeClient(target, launch);
}
