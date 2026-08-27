import { randomBytes } from "node:crypto";
import {
  createOpencodeClient,
  type Agent,
  type Command,
  type GlobalEvent,
  type Message,
  type OpencodeClient,
  type Part,
  type Provider,
  type QuestionInfo,
  type Session,
  type Todo,
} from "@opencode-ai/sdk/v2/client";
import type {
  AgentInteractionValue,
  AgentModel,
  AgentMode,
  AgentSessionStats,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import type {
  AgentRuntimeClient,
  AgentRuntimeEvent,
  AgentSubmissionOptions,
  ResolvedAgentImage,
} from "@overtchat/agent-runtime/providers/types";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";
import {
  openCodeErrorText,
  parseOpenCodeCommands,
  parseOpenCodeModels,
  parseOpenCodeModes,
  parseOpenCodeStats,
  projectOpenCodeMessage,
  projectOpenCodeMessages,
  type OpenCodeMessageWithParts,
} from "@overtchat/agent-runtime/opencode/protocol";
import {
  openCodeServerPool,
  type OpenCodeServerLease,
} from "@overtchat/agent-runtime/opencode/server";

const SUBMISSION_METADATA_KEY = "overtchatSubmissionIds";
const MESSAGE_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let lastMessageTimestamp = -1;
let messageCounter = 0;

type OpenCodeLaunch = {
  executable: string;
  cwd: string;
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  resumeSessionId?: string;
};

type PendingInteraction =
  | { kind: "permission"; requestId: string }
  | { kind: "question"; requestId: string; questions: QuestionInfo[] };

type OpenCodeTurnSelection = {
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
};

function createMessageId(now = Date.now()): string {
  if (now !== lastMessageTimestamp) messageCounter = 0;
  lastMessageTimestamp = now;
  messageCounter += 1;
  const ascending = (BigInt(now) * 0x1000n + BigInt(messageCounter))
    .toString(16)
    .padStart(12, "0")
    .slice(-12);
  const random = Array.from(randomBytes(14), (value) =>
    MESSAGE_ID_ALPHABET[value % MESSAGE_ID_ALPHABET.length],
  ).join("");
  return `msg_${ascending}${random}`;
}

function modelRef(modelId: string | undefined):
  | { providerID: string; modelID: string }
  | undefined {
  if (!modelId) return undefined;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator === modelId.length - 1) {
    throw new Error("OpenCode model id must include its provider.");
  }
  return {
    providerID: modelId.slice(0, separator),
    modelID: modelId.slice(separator + 1),
  };
}

function resultData<T>(result: { data?: T; error?: unknown }, operation: string): T {
  if (result.error !== undefined) {
    throw new Error(`${operation}: ${openCodeErrorText(result.error)}`);
  }
  if (result.data === undefined) throw new Error(`${operation} returned no data.`);
  return result.data;
}

function assertResult(result: { error?: unknown }, operation: string): void {
  if (result.error !== undefined) {
    throw new Error(`${operation}: ${openCodeErrorText(result.error)}`);
  }
}

function submissionIds(session: Session): Record<string, string> {
  const value = session.metadata?.[SUBMISSION_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) =>
      typeof candidate === "string" ? [[key, candidate]] : [],
    ),
  );
}

function sessionModel(session: Session): string | undefined {
  return session.model
    ? `${session.model.providerID}/${session.model.id}`
    : undefined;
}

function partsForPrompt(
  message: string,
  images: readonly ResolvedAgentImage[],
) {
  return [
    { type: "text" as const, text: message },
    ...images.map((image) => ({
      type: "file" as const,
      mime: image.mediaType,
      filename: image.filename,
      url: `data:${image.mediaType};base64,${image.data}`,
    })),
  ];
}

type OpenCodeEvent = {
  type: string;
  properties: Record<string, unknown>;
};

function sessionIdFromEvent(event: OpenCodeEvent): string | undefined {
  const properties = event.properties;
  if (typeof properties.sessionID === "string") return properties.sessionID;
  const info = properties.info;
  return info && typeof info === "object" && typeof Reflect.get(info, "sessionID") === "string"
    ? (Reflect.get(info, "sessionID") as string)
    : undefined;
}

function questionFields(questions: QuestionInfo[]) {
  return questions.map((question, index) => ({
    id: String(index),
    label: question.header || `Question ${index + 1}`,
    description: question.question,
    type: question.multiple
      ? ("multiselect" as const)
      : question.options.length
        ? ("select" as const)
        : ("text" as const),
    required: true,
    secret: false,
    options: question.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
  }));
}

function todoPart(todos: Todo[]) {
  return {
    type: "taskList",
    id: "opencode-todos",
    explanation: "OpenCode task progress",
    items: todos.map((todo, index) => ({
      id: `opencode-todo-${index}`,
      step: todo.content,
      status: todo.status,
      priority: todo.priority,
    })),
  };
}

export class OpenCodeRuntimeClient implements AgentRuntimeClient {
  private readonly subscribers = new Set<(event: AgentRuntimeEvent) => void>();
  private readonly pendingInteractions = new Map<string, PendingInteraction>();
  private readonly messageInfo = new Map<string, Message>();
  private readonly messageParts = new Map<string, Map<string, Part>>();
  private readonly abortEvents = new AbortController();
  private readonly readyPromise: Promise<void>;
  private lease?: OpenCodeServerLease;
  private client?: OpencodeClient;
  private session?: Session;
  private models: AgentModel[] = [];
  private modes: AgentMode[] = [];
  private commands: AgentSlashCommand[] = [];
  private selectedModel?: string;
  private thinkingOptionId?: string;
  private modeId?: string;
  private streaming = false;
  private compacting = false;
  private stopped = false;
  private submissions: Record<string, string> = {};
  private todos: Todo[] = [];
  private activeSelection?: OpenCodeTurnSelection;

  constructor(
    private readonly target: HostTarget,
    private readonly launch: OpenCodeLaunch,
  ) {
    this.selectedModel = launch.model;
    this.thinkingOptionId = launch.thinkingOptionId;
    this.modeId = launch.modeId;
    this.readyPromise = this.initialize().catch(async (error) => {
      this.stopped = true;
      this.abortEvents.abort();
      const lease = this.lease;
      this.lease = undefined;
      await lease?.release().catch(() => {});
      throw error;
    });
  }

  onEvent(subscriber: (event: AgentRuntimeEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async getState(): Promise<Record<string, unknown>> {
    await this.readyPromise;
    return {
      sessionId: this.session!.id,
      sessionFile: this.session!.id,
      sessionName: this.session!.title.trim() || null,
      model: this.selectedModel
        ? { provider: "opencode", id: this.selectedModel }
        : null,
      thinkingLevel: this.thinkingOptionId ?? "default",
      modeId: this.modeId ?? null,
      modes: this.modes,
      isStreaming: this.streaming,
      isCompacting: this.compacting,
    };
  }

  async getMessages(): Promise<{ messages: unknown[] }> {
    await this.readyPromise;
    const messages = await this.fetchMessages();
    const projected = projectOpenCodeMessages(messages, this.submissions);
    this.addTodos(projected);
    return { messages: projected };
  }

  async getAvailableModels(): Promise<AgentModel[]> {
    await this.readyPromise;
    return this.models;
  }

  async getSessionStats(): Promise<AgentSessionStats> {
    await this.readyPromise;
    const messages = await this.fetchMessages();
    const contextWindow = this.models.find((model) => model.id === this.selectedModel)
      ?.contextWindow;
    return {
      ...parseOpenCodeStats(messages, contextWindow ?? undefined),
      sessionFile: this.session!.id,
      sessionId: this.session!.id,
    };
  }

  async getCommands(): Promise<AgentSlashCommand[]> {
    await this.readyPromise;
    return this.commands;
  }

  prompt(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    return this.submit(message, images, options, false);
  }

  steer(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    return this.submit(message, images, options, true);
  }

  async abort(): Promise<unknown> {
    await this.readyPromise;
    const result = await this.client!.session.abort({
      sessionID: this.session!.id,
      directory: this.launch.cwd,
    });
    assertResult(result, "OpenCode abort");
    return result.data;
  }

  async setModel(modelId: string): Promise<unknown> {
    await this.readyPromise;
    modelRef(modelId);
    if (!this.models.some((model) => model.id === modelId)) {
      throw new Error(`OpenCode did not report model ${modelId}.`);
    }
    this.selectedModel = modelId;
    this.thinkingOptionId =
      this.models.find((model) => model.id === modelId)?.defaultThinkingOptionId ??
      "default";
    this.emitConfig();
    return undefined;
  }

  async setThinkingLevel(level: string): Promise<unknown> {
    await this.readyPromise;
    const selected = this.models.find((model) => model.id === this.selectedModel);
    if (
      level !== "default" &&
      !selected?.thinkingOptions?.some((option) => option.id === level)
    ) {
      throw new Error(`OpenCode model ${this.selectedModel ?? "selection"} does not provide variant ${level}.`);
    }
    this.thinkingOptionId = level;
    this.emitConfig();
    return undefined;
  }

  async setMode(modeId: string): Promise<unknown> {
    await this.readyPromise;
    if (!this.modes.some((mode) => mode.id === modeId)) {
      throw new Error(`OpenCode did not report agent ${modeId}.`);
    }
    this.modeId = modeId;
    this.emitConfig();
    return undefined;
  }

  async compact(customInstructions?: string): Promise<unknown> {
    await this.readyPromise;
    if (customInstructions) {
      throw new Error("OpenCode does not accept custom compaction instructions.");
    }
    const model = modelRef(this.selectedModel);
    const result = await this.client!.session.summarize({
      sessionID: this.session!.id,
      directory: this.launch.cwd,
      ...(model ? { providerID: model.providerID, modelID: model.modelID } : {}),
    });
    assertResult(result, "OpenCode compaction");
    return result.data;
  }

  setAutoCompaction(): Promise<unknown> {
    return Promise.reject(new Error("OpenCode manages context compaction automatically."));
  }

  async setSessionName(name: string): Promise<unknown> {
    await this.readyPromise;
    const result = await this.client!.session.update({
      sessionID: this.session!.id,
      directory: this.launch.cwd,
      title: name,
    });
    this.session = resultData(result, "OpenCode session rename");
    this.emit({ type: "session_info_update", title: name });
    return this.session;
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
    if (!pending || !this.client) return;
    this.pendingInteractions.delete(id);
    const action = async () => {
      if (pending.kind === "permission") {
        const reply = response.cancelled
          ? "reject"
          : response.value === "Allow always"
            ? "always"
            : response.value === "Allow once" || response.confirmed
              ? "once"
              : "reject";
        assertResult(
          await this.client!.permission.reply({
            requestID: pending.requestId,
            directory: this.launch.cwd,
            reply,
          }),
          "OpenCode permission response",
        );
        return;
      }
      if (response.cancelled) {
        assertResult(
          await this.client!.question.reject({
            requestID: pending.requestId,
            directory: this.launch.cwd,
          }),
          "OpenCode question rejection",
        );
        return;
      }
      const answers = pending.questions.map((question, index) => {
        const value = response.values?.[String(index)] ??
          (pending.questions.length === 1 ? response.value : undefined);
        if (Array.isArray(value)) return value;
        if (value === undefined) return [];
        return [String(value)];
      });
      assertResult(
        await this.client!.question.reply({
          requestID: pending.requestId,
          directory: this.launch.cwd,
          answers,
        }),
        "OpenCode question response",
      );
    };
    void action().catch((error) => {
      this.emit({ type: "rpc_error", command: "interaction_response", error: openCodeErrorText(error) });
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.abortEvents.abort();
    await this.readyPromise.catch(() => {});
    await this.lease?.release().catch(() => {});
  }

  private async initialize(): Promise<void> {
    this.lease = await openCodeServerPool.acquire(this.target, this.launch.executable);
    this.client = createOpencodeClient({
      baseUrl: this.lease.baseUrl,
      directory: this.launch.cwd,
    });
    const stream = await this.client.global.event({ signal: this.abortEvents.signal });
    void this.runEventLoop(stream.stream);

    const [providerResult, agentResult, commandResult, configResult] = await Promise.all([
      this.client.provider.list({ directory: this.launch.cwd }),
      this.client.app.agents({ directory: this.launch.cwd }),
      this.client.command.list({ directory: this.launch.cwd }),
      this.client.config.get({ directory: this.launch.cwd }),
    ]);
    const config = resultData(configResult, "OpenCode configuration");
    this.models = parseOpenCodeModels(
      resultData(providerResult, "OpenCode provider catalog"),
      config.model,
    );
    this.modes = parseOpenCodeModes(resultData(agentResult, "OpenCode agent catalog") as Agent[]);
    this.commands = parseOpenCodeCommands(resultData(commandResult, "OpenCode command catalog") as Command[]);
    const requestedModel = this.selectedModel;
    if (requestedModel && !this.models.some((model) => model.id === requestedModel)) {
      throw new Error(`OpenCode did not report configured model ${requestedModel}.`);
    }
    const selectedModel = requestedModel ?? this.models.find((model) => model.isDefault)?.id ?? this.models[0]?.id;
    const selectedRef = modelRef(selectedModel);
    if (this.launch.resumeSessionId) {
      this.session = resultData(
        await this.client.session.get({
          sessionID: this.launch.resumeSessionId,
          directory: this.launch.cwd,
        }),
        "OpenCode session resume",
      );
    } else {
      this.session = resultData(
        await this.client.session.create({
          directory: this.launch.cwd,
          ...(this.modeId ? { agent: this.modeId } : {}),
          ...(selectedRef
            ? {
                model: {
                  id: selectedRef.modelID,
                  providerID: selectedRef.providerID,
                  ...(this.thinkingOptionId && this.thinkingOptionId !== "default"
                    ? { variant: this.thinkingOptionId }
                    : {}),
                },
              }
            : {}),
        }),
        "OpenCode session create",
      );
    }
    this.selectedModel = requestedModel ?? sessionModel(this.session) ?? selectedModel;
    this.thinkingOptionId = this.launch.thinkingOptionId ?? this.session.model?.variant ?? "default";
    this.modeId =
      this.launch.modeId ??
      this.session.agent ??
      config.default_agent ??
      this.modes.find((mode) => mode.id === "build")?.id ??
      this.modes[0]?.id;
    this.submissions = submissionIds(this.session);
    const messages = await this.fetchMessages();
    for (const message of messages) this.rememberMessage(message);
    const todoResult = await this.client.session.todo({
      sessionID: this.session.id,
      directory: this.launch.cwd,
    });
    if (!todoResult.error && todoResult.data) this.todos = todoResult.data;
    const statusResult = await this.client.session.status({ directory: this.launch.cwd });
    if (!statusResult.error) {
      this.streaming = statusResult.data?.[this.session.id]?.type === "busy";
    }
    void this.lease.exit.then((error) => {
      if (!this.stopped) this.emit({ type: "process_exit", error: error.message });
    });
  }

  private async submit(
    message: string,
    images: readonly ResolvedAgentImage[],
    options: AgentSubmissionOptions,
    steering: boolean,
  ): Promise<unknown> {
    await this.readyPromise;
    const selection = steering
      ? (this.activeSelection ?? this.currentSelection())
      : this.currentSelection();
    if (!steering) this.activeSelection = selection;
    const command = /^\/([^\s]+)(?:\s+([\s\S]*))?$/u.exec(message.trim());
    const discovered =
      !steering &&
      command &&
      this.commands.some((item) => item.name === command[1]);
    const id = createMessageId();
    try {
      if (options.clientMessageId) {
        await this.rememberSubmission(id, options.clientMessageId);
      }
    } catch (error) {
      if (!steering) this.activeSelection = undefined;
      throw error;
    }
    if (discovered) {
      try {
        const result = await this.client!.session.command({
          sessionID: this.session!.id,
          directory: this.launch.cwd,
          messageID: id,
          command: command![1],
          arguments: command![2] ?? "",
          ...(selection.model ? { model: selection.model } : {}),
          ...(selection.modeId ? { agent: selection.modeId } : {}),
          ...(selection.thinkingOptionId &&
          selection.thinkingOptionId !== "default"
            ? { variant: selection.thinkingOptionId }
            : {}),
          parts: images.map((image) => ({
            type: "file" as const,
            mime: image.mediaType,
            filename: image.filename,
            url: `data:${image.mediaType};base64,${image.data}`,
          })),
        });
        assertResult(result, `OpenCode /${command![1]} command`);
        return result.data;
      } catch (error) {
        if (!steering) this.activeSelection = undefined;
        throw error;
      }
    }
    try {
      const selectedModel = modelRef(selection.model);
      const result = await this.client!.session.promptAsync({
        sessionID: this.session!.id,
        directory: this.launch.cwd,
        messageID: id,
        parts: partsForPrompt(message, images),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selection.modeId ? { agent: selection.modeId } : {}),
        ...(selection.thinkingOptionId && selection.thinkingOptionId !== "default"
          ? { variant: selection.thinkingOptionId }
          : {}),
      });
      assertResult(result, "OpenCode prompt");
      return result.data;
    } catch (error) {
      if (!steering) this.activeSelection = undefined;
      throw error;
    }
  }

  private currentSelection(): OpenCodeTurnSelection {
    return {
      model: this.selectedModel,
      thinkingOptionId: this.thinkingOptionId,
      modeId: this.modeId,
    };
  }

  private async rememberSubmission(providerMessageId: string, clientMessageId: string) {
    this.submissions[providerMessageId] = clientMessageId;
    const entries = Object.entries(this.submissions).slice(-256);
    this.submissions = Object.fromEntries(entries);
    const result = await this.client!.session.update({
      sessionID: this.session!.id,
      directory: this.launch.cwd,
      metadata: {
        ...(this.session!.metadata ?? {}),
        [SUBMISSION_METADATA_KEY]: this.submissions,
      },
    });
    this.session = resultData(result, "OpenCode submission checkpoint");
  }

  private async fetchMessages(): Promise<OpenCodeMessageWithParts[]> {
    const result = await this.client!.session.messages({
      sessionID: this.session!.id,
      directory: this.launch.cwd,
    });
    return resultData(result, "OpenCode messages");
  }

  private rememberMessage(message: OpenCodeMessageWithParts): void {
    this.messageInfo.set(message.info.id, message.info);
    this.messageParts.set(message.info.id, new Map(message.parts.map((part) => [part.id, part])));
  }

  private message(messageId: string): OpenCodeMessageWithParts | null {
    const info = this.messageInfo.get(messageId);
    if (!info) return null;
    return { info, parts: [...(this.messageParts.get(messageId)?.values() ?? [])] };
  }

  private emitProjected(messageId: string): void {
    const message = this.message(messageId);
    if (!message) return;
    const projected = projectOpenCodeMessage(message, this.submissions);
    this.addTodos(projected);
    for (const item of projected) this.emit({ type: "message_update", message: item });
  }

  private addTodos(projected: unknown[]): void {
    if (!this.todos.length) return;
    const assistant = [...projected].reverse().find((item) =>
      item && typeof item === "object" && Reflect.get(item, "role") === "assistant",
    );
    if (!assistant || typeof assistant !== "object") return;
    const content = Reflect.get(assistant, "content");
    if (Array.isArray(content) && !content.some((part) => part && typeof part === "object" && Reflect.get(part, "type") === "taskList")) {
      content.push(todoPart(this.todos));
    }
  }

  private async consumeEvents(stream: AsyncIterable<GlobalEvent>): Promise<void> {
    for await (const envelope of stream) {
      if (this.stopped) continue;
      const payload = envelope.payload as unknown as Record<string, unknown>;
      if (
        typeof payload.type !== "string" ||
        !payload.properties ||
        typeof payload.properties !== "object" ||
        Array.isArray(payload.properties)
      ) {
        continue;
      }
      const event: OpenCodeEvent = {
        type: payload.type,
        properties: payload.properties as Record<string, unknown>,
      };
      const sessionId = sessionIdFromEvent(event);
      if (this.session && sessionId && sessionId !== this.session.id) continue;
      if (
        this.session &&
        !sessionId &&
        envelope.directory !== this.session.directory
      ) {
        continue;
      }
      this.handleEvent(event);
    }
  }

  private async runEventLoop(initialStream: AsyncIterable<GlobalEvent>): Promise<void> {
    let stream = initialStream;
    let failures = 0;
    while (!this.stopped && !this.abortEvents.signal.aborted) {
      try {
        await this.consumeEvents(stream);
      } catch (error) {
        if (this.stopped || this.abortEvents.signal.aborted) return;
        failures += 1;
        if (failures === 3) {
          this.emit({
            type: "rpc_error",
            command: "events",
            error: `OpenCode event stream is reconnecting: ${openCodeErrorText(error)}`,
          });
        }
      }
      while (!this.stopped && !this.abortEvents.signal.aborted) {
        await this.waitForEventReconnect(
          Math.min(2_000, 100 * 2 ** Math.min(failures, 5)),
        );
        if (this.stopped || this.abortEvents.signal.aborted) return;
        try {
          const next = await this.client!.global.event({
            signal: this.abortEvents.signal,
          });
          stream = next.stream;
          failures = 0;
          await this.reconcileAfterReconnect().catch((error) => {
            this.emit({
              type: "rpc_error",
              command: "events",
              error: `OpenCode reconnected but could not reconcile: ${openCodeErrorText(error)}`,
            });
          });
          break;
        } catch (error) {
          if (this.stopped || this.abortEvents.signal.aborted) return;
          failures += 1;
          if (failures === 3) {
            this.emit({
              type: "rpc_error",
              command: "events",
              error: `OpenCode event stream is reconnecting: ${openCodeErrorText(error)}`,
            });
          }
        }
      }
    }
  }

  private waitForEventReconnect(delayMs: number): Promise<void> {
    if (this.abortEvents.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        this.abortEvents.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timeout = setTimeout(finish, delayMs);
      timeout.unref();
      this.abortEvents.signal.addEventListener("abort", finish, { once: true });
    });
  }

  private async reconcileAfterReconnect(): Promise<void> {
    if (!this.session) return;
    const [sessionResult, messages, todoResult, statusResult] = await Promise.all([
      this.client!.session.get({
        sessionID: this.session.id,
        directory: this.launch.cwd,
      }),
      this.fetchMessages(),
      this.client!.session.todo({
        sessionID: this.session.id,
        directory: this.launch.cwd,
      }),
      this.client!.session.status({ directory: this.launch.cwd }),
    ]);
    this.session = resultData(sessionResult, "OpenCode session reconciliation");
    this.submissions = submissionIds(this.session);
    this.messageInfo.clear();
    this.messageParts.clear();
    for (const message of messages) this.rememberMessage(message);
    if (!todoResult.error && todoResult.data) this.todos = todoResult.data;
    for (const message of messages) this.emitProjected(message.info.id);
    if (!statusResult.error) {
      this.handleEvent({
        type: "session.status",
        properties: {
          sessionID: this.session.id,
          status: statusResult.data?.[this.session.id] ?? { type: "idle" },
        },
      });
    }
  }

  private handleEvent(event: OpenCodeEvent): void {
    if (!this.session) return;
    const properties = event.properties as Record<string, unknown>;
    switch (event.type) {
      case "session.status": {
        const status = properties.status as
          | { type?: string; message?: string }
          | undefined;
        if (status?.type === "busy" && !this.streaming) {
          this.streaming = true;
          this.emit({ type: "turn_start" });
        } else if (status?.type === "idle" && this.streaming) {
          this.streaming = false;
          this.compacting = false;
          this.activeSelection = undefined;
          this.emit({ type: "turn_end", status: "completed" });
        } else if (status?.type === "retry") {
          this.emit({ type: "rpc_error", command: "prompt", error: String(status.message ?? "OpenCode is retrying the turn.") });
        }
        break;
      }
      case "session.idle":
        if (this.streaming) {
          this.streaming = false;
          this.compacting = false;
          this.activeSelection = undefined;
          this.emit({ type: "turn_end", status: "completed" });
        }
        break;
      case "session.error":
        this.streaming = false;
        this.activeSelection = undefined;
        this.emit({ type: "rpc_error", command: "prompt", error: openCodeErrorText(properties.error) });
        this.emit({ type: "turn_end", status: "failed" });
        break;
      case "session.updated": {
        const info = properties.info as Session | undefined;
        if (info) {
          this.session = info;
          this.emit({ type: "session_info_update", title: info.title });
        }
        break;
      }
      case "message.updated": {
        const info = properties.info as Message | undefined;
        if (info) {
          this.messageInfo.set(info.id, info);
          this.messageParts.set(info.id, this.messageParts.get(info.id) ?? new Map());
          this.emitProjected(info.id);
        }
        break;
      }
      case "message.part.updated": {
        const part = properties.part as Part | undefined;
        if (part) {
          const parts = this.messageParts.get(part.messageID) ?? new Map<string, Part>();
          parts.set(part.id, part);
          this.messageParts.set(part.messageID, parts);
          this.emitProjected(part.messageID);
          if (part.type === "tool") this.emitTool(part);
        }
        break;
      }
      case "message.part.delta": {
        const messageId = properties.messageID;
        const partId = properties.partID;
        const field = properties.field;
        const delta = properties.delta;
        if (typeof messageId === "string" && typeof partId === "string" && typeof field === "string" && typeof delta === "string") {
          const part = this.messageParts.get(messageId)?.get(partId);
          if (part && (part.type === "text" || part.type === "reasoning") && field === "text") {
            part.text += delta;
            this.emitProjected(messageId);
          }
        }
        break;
      }
      case "todo.updated":
        if (Array.isArray(properties.todos)) {
          this.todos = properties.todos as Todo[];
          const lastAssistant = [...this.messageInfo.values()].reverse().find((message) => message.role === "assistant");
          if (lastAssistant) this.emitProjected(lastAssistant.id);
        }
        break;
      case "permission.v2.asked":
      case "permission.asked": {
        const requestId = String(properties.id ?? "");
        if (!requestId) break;
        const id = `opencode:permission:${requestId}`;
        this.pendingInteractions.set(id, { kind: "permission", requestId });
        const patterns = Array.isArray(properties.patterns)
          ? properties.patterns.join("\n")
          : Array.isArray(properties.resources)
            ? properties.resources.join("\n")
            : "";
        this.emit({
          type: "interaction_request",
          id,
          method: "select",
          title: `Allow ${String(properties.permission ?? properties.action ?? "OpenCode action")}?`,
          message: patterns || "OpenCode needs permission to continue.",
          options: ["Allow once", "Allow always", "Deny"],
          approvalKind: "tool",
          toolName: String(properties.permission ?? properties.action ?? "OpenCode"),
          toolDetail: { type: "shell", command: patterns },
          approveValue: "Allow once",
          alwaysValue: "Allow always",
          denyValue: "Deny",
        });
        break;
      }
      case "permission.v2.replied":
      case "permission.replied": {
        const id = `opencode:permission:${String(properties.requestID ?? "")}`;
        this.pendingInteractions.delete(id);
        this.emit({ type: "interaction_resolved", id });
        break;
      }
      case "question.v2.asked":
      case "question.asked": {
        const requestId = String(properties.id ?? "");
        const questions = Array.isArray(properties.questions)
          ? (properties.questions as QuestionInfo[])
          : [];
        if (!requestId || !questions.length) break;
        const id = `opencode:question:${requestId}`;
        this.pendingInteractions.set(id, { kind: "question", requestId, questions });
        this.emit({
          type: "interaction_request",
          id,
          method: "form",
          title: questions.length === 1 ? questions[0].header : "OpenCode needs your input",
          message: questions.length === 1 ? questions[0].question : "Answer the following questions to continue.",
          fields: questionFields(questions),
        });
        break;
      }
      case "question.v2.replied":
      case "question.v2.rejected":
      case "question.replied":
      case "question.rejected": {
        const id = `opencode:question:${String(properties.requestID ?? "")}`;
        this.pendingInteractions.delete(id);
        this.emit({ type: "interaction_resolved", id });
        break;
      }
      case "session.compacted":
        this.compacting = false;
        this.emit({ type: "compaction_end" });
        break;
      case "session.next.compaction.started":
        this.compacting = true;
        this.emit({ type: "compaction_start", reason: properties.reason });
        break;
      case "session.next.compaction.ended":
        this.compacting = false;
        this.emit({ type: "compaction_end" });
        break;
    }
  }

  private emitTool(part: Extract<Part, { type: "tool" }>): void {
    const base = {
      toolCallId: part.callID,
      toolName: part.tool,
    };
    if (part.state.status === "completed") {
      this.emit({
        type: "tool_execution_end",
        ...base,
        result: { content: [{ type: "text", text: part.state.output }] },
        isError: false,
      });
    } else if (part.state.status === "error") {
      this.emit({
        type: "tool_execution_end",
        ...base,
        result: { content: [{ type: "text", text: part.state.error }] },
        isError: true,
      });
    } else {
      this.emit({
        type: "tool_execution_update",
        ...base,
        partialResult: {
          content: [{ type: "text", text: JSON.stringify(part.state.input ?? {}) }],
        },
      });
    }
  }

  private emitConfig(): void {
    this.emit({
      type: "config_update",
      model: this.selectedModel ? { provider: "opencode", id: this.selectedModel } : null,
      thinkingLevel: this.thinkingOptionId ?? "default",
      modeId: this.modeId ?? null,
      modes: this.modes,
    });
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

export function startOpenCodeRuntime(
  target: HostTarget,
  launch: OpenCodeLaunch,
): OpenCodeRuntimeClient {
  return new OpenCodeRuntimeClient(target, launch);
}

export async function fetchOpenCodeCatalog(
  target: HostTarget,
  executable: string,
  cwd?: string,
): Promise<{ models: AgentModel[]; modes: AgentMode[]; defaultModeId: string | null }> {
  const lease = await openCodeServerPool.acquire(target, executable);
  try {
    const client = createOpencodeClient({
      baseUrl: lease.baseUrl,
      ...(cwd ? { directory: cwd } : {}),
    });
    const directory = cwd ? { directory: cwd } : {};
    const [providers, agents, config] = await Promise.all([
      client.provider.list(directory),
      client.app.agents(directory),
      client.config.get(directory),
    ]);
    const resolvedConfig = resultData(config, "OpenCode configuration");
    const modes = parseOpenCodeModes(
      resultData(agents, "OpenCode agent catalog") as Agent[],
    );
    return {
      models: parseOpenCodeModels(
        resultData(providers, "OpenCode provider catalog") as {
          all: Provider[];
          connected: string[];
          default: Record<string, string>;
        },
        resolvedConfig.model,
      ),
      modes,
      defaultModeId:
        (resolvedConfig.default_agent &&
        modes.some((mode) => mode.id === resolvedConfig.default_agent)
          ? resolvedConfig.default_agent
          : modes.find((mode) => mode.id === "build")?.id) ??
        modes[0]?.id ??
        null,
    };
  } finally {
    await lease.release();
  }
}

export async function listOpenCodeSessions(
  target: HostTarget,
  executable: string,
  cwd: string,
): Promise<Array<{ session: Session; messages: OpenCodeMessageWithParts[] }>> {
  const lease = await openCodeServerPool.acquire(target, executable);
  try {
    const client = createOpencodeClient({ baseUrl: lease.baseUrl, directory: cwd });
    const sessions = resultData(
      await client.session.list({
        directory: cwd,
        scope: "project",
        roots: true,
        limit: 200,
      }),
      "OpenCode session list",
    );
    const results: Array<{
      session: Session;
      messages: OpenCodeMessageWithParts[];
    }> = new Array(sessions.length);
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, sessions.length) }, async () => {
        while (nextIndex < sessions.length) {
          const index = nextIndex++;
          const session = sessions[index]!;
          let messages: OpenCodeMessageWithParts[] = [];
          try {
            messages = resultData(
              await client.session.messages({
                sessionID: session.id,
                directory: cwd,
              }),
              `OpenCode messages for ${session.id}`,
            );
          } catch {
            // Session identity and timestamps come from the authoritative list.
            // Message-derived metadata is optional enrichment and one corrupt or
            // transiently unavailable history must not hide every other session.
          }
          results[index] = { session, messages };
        }
      }),
    );
    return results;
  } finally {
    await lease.release();
  }
}

export async function deleteOpenCodeSession(
  target: HostTarget,
  executable: string,
  cwd: string,
  sessionId: string,
): Promise<void> {
  const lease = await openCodeServerPool.acquire(target, executable);
  try {
    const client = createOpencodeClient({ baseUrl: lease.baseUrl, directory: cwd });
    assertResult(
      await client.session.delete({
        sessionID: sessionId,
        directory: cwd,
      }),
      `OpenCode delete session ${sessionId}`,
    );
  } finally {
    await lease.release();
  }
}
