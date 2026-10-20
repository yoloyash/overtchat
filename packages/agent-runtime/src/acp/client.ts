import { randomUUID } from "node:crypto";
import type {
  AgentCapabilities,
  ContentBlock,
  LoadSessionResponse,
  NewSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type {
  AgentModel,
  AgentMode,
  AgentProviderId,
  AgentSessionStats,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import type {
  AgentRuntimeClient,
  AgentRuntimeEvent,
  AgentSessionLaunch,
  AgentSubmissionOptions,
  ResolvedAgentImage,
} from "../providers/types";
import type { HostTarget } from "../runtime/process";
import { AcpConnection, acpError } from "./connection";
import { AcpProjection, toolDetails, type AcpMessage } from "./projection";

export type AcpProvider = {
  id: AgentProviderId;
  label: string;
  args: string[];
  compactCommand?: string;
  dangerousModes?: readonly string[];
  /** Refresh native state after commands that change history or configuration. */
  reloadCommands?: Readonly<Record<string, "history" | "config">>;
  historyUserText?: (text: string) => string;
};

type Permission = {
  id: string;
  request: RequestPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
};

export class AcpRuntimeClient implements AgentRuntimeClient {
  private readonly subscribers = new Set<(event: AgentRuntimeEvent) => void>();
  private readonly ready: Promise<void>;
  private connection?: AcpConnection;
  private capabilities: AgentCapabilities = {};
  private sessionId = "";
  private sessionName: string | null = null;
  private models: AgentModel[] = [];
  private modes: AgentMode[] = [];
  private modelId?: string;
  private modeId?: string;
  private commands: AgentSlashCommand[] = [];
  // ACP replay has no durable message IDs. A fresh runtime must not reuse
  // compacted context indexes as identities in the retained display timeline.
  private readonly projectionId = randomUUID();
  private projection = new AcpProjection(() => `${this.sessionId}:${this.projectionId}`);
  private loading = true;
  private streaming = false;
  private compacting = false;
  private activePrompt?: Promise<void>;
  private stopped = false;
  private stopPromise?: Promise<void>;
  private failure?: Error;
  private readonly permissions: Permission[] = [];
  private contextUsage?: AgentSessionStats["contextUsage"];
  private cost = 0;
  private tokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  private resolveCommands!: () => void;
  private readonly commandsReady = new Promise<void>((resolve) => {
    this.resolveCommands = resolve;
  });

  constructor(
    private readonly target: HostTarget,
    private readonly launch: AgentSessionLaunch,
    private readonly provider: AcpProvider,
  ) {
    this.sessionId = launch.resume?.providerSessionId ?? "";
    this.ready = this.initialize().catch(async (error) => {
      this.failure = acpError(error);
      await this.connection?.stop();
      throw this.failure;
    });
    // Consumers may attach through any of the async getters on the next tick.
    void this.ready.catch(() => {});
  }

  onEvent(subscriber: (event: AgentRuntimeEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private emit(event: AgentRuntimeEvent): void {
    if (this.loading) return;
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private publish(messages: AcpMessage[]): void {
    // ACP history replay has no original timestamps. Stamp only live events;
    // using replay time would invent durations for imported conversations.
    if (this.loading) return;
    const now = Date.now();
    for (const message of messages) {
      message.timestamp ??= now;
      message.updatedAt = now;
    }
    for (const turnId of new Set(
      messages.map((message) => message.overtchatTurnId),
    )) {
      this.emit({
        type: "overtchat_turn_update",
        turnId,
        messages: structuredClone(
          this.projection.messages.filter(
            (message) => message.overtchatTurnId === turnId,
          ),
        ),
      });
    }
  }

  private async initialize(): Promise<void> {
    this.connection = await AcpConnection.start(
      this.target,
      {
        command: this.launch.executable,
        args: this.provider.args,
        cwd: this.launch.cwd,
      },
      this.provider.label,
      {
        sessionUpdate: async (notification) => this.update(notification),
        requestPermission: (request) => this.requestPermission(request),
      },
      (error) => {
        this.failure = error;
        this.cancelPermissions();
        if (!this.stopped)
          this.emit({ type: "process_exit", error: error.message });
      },
    );
    if (this.stopped) {
      await this.connection.stop();
      return;
    }
    this.capabilities =
      (await this.connection.initialize()).agentCapabilities ?? {};
    let response: NewSessionResponse | LoadSessionResponse;
    if (this.launch.resume) {
      if (!this.capabilities.loadSession)
        throw new Error(
          `${this.provider.label} does not support loading sessions. Update it on the execution host.`,
        );
      response = await this.connection.request(
        this.connection.rpc.loadSession({
          sessionId: this.sessionId,
          cwd: this.launch.cwd,
          mcpServers: [],
        }),
        "load session",
      );
    } else {
      const created = await this.connection.request(
        this.connection.rpc.newSession({
          cwd: this.launch.cwd,
          mcpServers: [],
        }),
        "create session",
      );
      this.sessionId = created.sessionId;
      response = created;
    }
    if (!this.sessionId || !response)
      throw new Error(`${this.provider.label} did not return a valid session.`);
    this.applySession(response);
    if (
      this.launch.thinkingOptionId &&
      this.launch.thinkingOptionId !== "default"
    ) {
      throw new Error(
        `${this.provider.label} does not expose reasoning settings through ACP.`,
      );
    }
    if (this.launch.model && this.launch.model !== this.modelId)
      await this.changeModel(this.launch.model);
    if (this.launch.modeId && this.launch.modeId !== this.modeId)
      await this.changeMode(this.launch.modeId);
    this.projection.endTurn();
    this.loading = false;
  }

  private applySession(
    response: NewSessionResponse | LoadSessionResponse,
  ): void {
    this.modelId = response.models?.currentModelId ?? this.modelId;
    this.models = (response.models?.availableModels ?? []).map(
      (model): AgentModel => ({
        provider: this.provider.id,
        id: model.modelId,
        label: model.name,
        description: model.description ?? undefined,
        isDefault: model.modelId === this.modelId,
        api: "acp",
        baseUrl: "",
        reasoning: false,
        input: this.capabilities.promptCapabilities?.image
          ? ["text", "image"]
          : ["text"],
        contextWindow: null,
        maxTokens: null,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    this.modeId = response.modes?.currentModeId ?? this.modeId;
    this.modes = (response.modes?.availableModes ?? []).map((mode) => ({
      id: mode.id,
      label: mode.name,
      description: mode.description ?? "",
      ...(this.provider.dangerousModes?.includes(mode.id)
        ? { dangerous: true }
        : {}),
    }));
  }

  private update(notification: SessionNotification): void {
    if (
      this.stopped ||
      (this.sessionId && notification.sessionId !== this.sessionId)
    )
      return;
    // Notifications may arrive before session/new returns.
    this.sessionId ||= notification.sessionId;
    let update = notification.update;
    if (
      this.loading &&
      update.sessionUpdate === "user_message_chunk" &&
      update.content.type === "text" &&
      this.provider.historyUserText
    ) {
      update = {
        ...update,
        content: {
          ...update.content,
          text: this.provider.historyUserText(update.content.text),
        },
      };
    }
    this.publish(this.projection.update(update));
    switch (update.sessionUpdate) {
      case "available_commands_update":
        this.commands = update.availableCommands.map((command) => ({
          name: command.name,
          description: command.description,
          argumentHint: command.input?.hint,
          source: "custom",
        }));
        this.resolveCommands();
        this.emit({ type: "commands_update", commands: this.commands });
        break;
      case "current_mode_update":
        this.modeId = update.currentModeId;
        this.emitConfig();
        break;
      case "session_info_update":
        if (update.title != null) {
          this.sessionName = update.title;
          this.emit({ type: "session_info_update", title: update.title });
        }
        break;
      case "usage_update":
        if (update.size > 0)
          this.contextUsage = {
            tokens: update.used,
            contextWindow: update.size,
            percent: (update.used / update.size) * 100,
          };
        if (update.cost?.currency === "USD") this.cost = update.cost.amount;
        this.emit({
          type: "usage_update",
          usage: {
            ...(this.contextUsage ? { contextUsage: this.contextUsage } : {}),
            ...(update.cost?.currency === "USD" ? { cost: this.cost } : {}),
          },
        });
        break;
    }
  }

  private emitConfig(): void {
    this.emit({
      type: "config_update",
      model: { provider: this.provider.id, id: this.modelId },
      modeId: this.modeId,
      modes: this.modes,
    });
  }

  async getState(): Promise<Record<string, unknown>> {
    await this.ready;
    return {
      sessionId: this.sessionId,
      sessionFile: this.sessionId,
      sessionName: this.sessionName,
      model: this.modelId
        ? { provider: this.provider.id, id: this.modelId }
        : null,
      modes: this.modes,
      modeId: this.modeId,
      isStreaming: this.streaming,
      isCompacting: this.compacting,
    };
  }
  async getMessages(): Promise<{ messages: unknown[] }> {
    await this.ready;
    return { messages: structuredClone(this.projection.messages) };
  }
  async getAvailableModels(): Promise<AgentModel[]> {
    await this.ready;
    return this.models;
  }
  async getCommands(): Promise<AgentSlashCommand[]> {
    await this.ready;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.commandsReady,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return this.commands;
  }
  async getSessionStats(): Promise<AgentSessionStats> {
    await this.ready;
    const messages = this.projection.messages;
    return {
      sessionId: this.sessionId,
      sessionFile: this.sessionId,
      userMessages: messages.filter((m) => m.role === "user").length,
      assistantMessages: messages.filter((m) => m.role === "assistant").length,
      toolCalls: messages.reduce(
        (sum, m) => sum + m.content.filter((p) => p.type === "toolCall").length,
        0,
      ),
      toolResults: messages.filter((m) => m.role === "toolResult").length,
      totalMessages: messages.length,
      tokens: { ...this.tokens },
      cost: this.cost,
      ...(this.contextUsage ? { contextUsage: this.contextUsage } : {}),
    };
  }

  async prompt(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.stopped) throw new Error(`${this.provider.label} is stopped.`);
    if (this.streaming)
      throw new Error(
        `${this.provider.label} is already working. Queue the message instead.`,
      );
    if (images.length && !this.capabilities.promptCapabilities?.image)
      throw new Error(`${this.provider.label} does not accept images.`);
    const imageBlocks: ContentBlock[] = images.map((image) => ({
      type: "image",
      data: image.data,
      mimeType: image.mediaType,
    }));
    this.streaming = true;
    this.emit({ type: "turn_start" });
    const user = this.projection.beginTurn(
      message,
      imageBlocks,
      options.clientMessageId,
    );
    this.publish([user]);
    // ACP answers session/prompt at turn completion. Keep the connector's command
    // acknowledgement short; results/errors are delivered through its journaled events.
    this.activePrompt = this.connection!.rpc.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: message }, ...imageBlocks],
    })
      .then(async (response) => {
        if (response.usage) {
          this.tokens.input += response.usage.inputTokens;
          this.tokens.output += response.usage.outputTokens;
          this.tokens.cacheRead += response.usage.cachedReadTokens ?? 0;
          this.tokens.cacheWrite += response.usage.cachedWriteTokens ?? 0;
          this.tokens.total += response.usage.totalTokens;
          this.emit({
            type: "usage_update",
            usage: { tokens: { ...this.tokens } },
          });
        }
        // Hermes treats commands case-insensitively and only dispatches them
        // for text-only prompts. Media prompts remain ordinary conversations.
        const command =
          images.length === 0
            ? /^\/([^\s]+)/u.exec(message.trim())?.[1]?.toLowerCase()
            : undefined;
        const refresh = command
          ? this.provider.reloadCommands?.[command]
          : undefined;
        if (refresh === "history" || refresh === "config")
          await this.reloadSession(refresh, user.overtchatTurnId);
      })
      .catch((error: unknown) => {
        if (!this.stopped)
          this.emit({
            type: "rpc_error",
            command: "prompt",
            error: acpError(error).message,
          });
      })
      .finally(() => {
        this.activePrompt = undefined;
        this.finishTurn();
      });
    return { accepted: true };
  }

  private async reloadSession(
    refresh: "history" | "config",
    commandTurnId: string,
  ): Promise<void> {
    const previous = this.projection;
    // Reset/compression can remove rows. Reusing their IDs would let runtime
    // reconciliation attach an old submitted prompt to a different message.
    const historyId = `${this.sessionId}:history:${randomUUID()}`;
    this.projection = new AcpProjection(() => historyId);
    this.loading = true;
    try {
      const response = await this.connection!.request(
        this.connection!.rpc.loadSession({
          sessionId: this.sessionId,
          cwd: this.launch.cwd,
          mcpServers: [],
        }),
        "reload session",
      );
      this.applySession(response);
      if (refresh === "config") {
        this.projection = previous;
      } else {
        // Native history omits slash-command responses, including errors.
        // Keep that feedback after replacing the conversation context.
        this.projection.appendTurn(
          previous.messages.filter(
            (message) => message.overtchatTurnId === commandTurnId,
          ),
        );
      }
    } catch (error) {
      this.projection = previous;
      throw error;
    } finally {
      this.loading = false;
    }
    if (refresh === "history") {
      this.emit({
        type: "overtchat_history_replace",
        messages: structuredClone(this.projection.messages),
      });
    }
    this.emitConfig();
  }

  private finishTurn(): void {
    if (!this.streaming || this.activePrompt) return;
    this.cancelPermissions();
    const changed = this.projection.endTurn();
    // Streaming can keep appending to the same message. Its creation time is
    // not the end of the response; retain completion time as well.
    const last = this.projection.messages.at(-1);
    const answer = [...this.projection.messages].reverse().find((message) =>
      message.role === "assistant" && message.overtchatTurnId === last?.overtchatTurnId,
    );
    if (answer?.timestamp !== undefined && !changed.includes(answer)) changed.push(answer);
    this.publish(changed);
    this.streaming = false;
    if (!this.stopped) {
      this.emit({ type: "turn_end" });
      if (this.compacting) {
        this.compacting = false;
        this.emit({ type: "compaction_end" });
      }
    }
  }

  steer(): Promise<never> {
    return Promise.reject(
      new Error(
        "ACP steering is handled by the runtime's cancel-and-restart path.",
      ),
    );
  }
  async abort(): Promise<void> {
    await this.ready;
    this.cancelPermissions();
    if (!this.streaming) return;
    await this.connection!.rpc.cancel({ sessionId: this.sessionId });
    await this.connection!.request(
      this.activePrompt ?? Promise.resolve(),
      "cancel",
      10_000,
    );
  }
  private async changeModel(modelId: string): Promise<void> {
    if (!this.models.some((model) => model.id === modelId))
      throw new Error(
        `${this.provider.label} did not advertise model ${modelId}.`,
      );
    await this.connection!.request(
      this.connection!.rpc.unstable_setSessionModel({
        sessionId: this.sessionId,
        modelId,
      }),
      "set model",
    );
    this.modelId = modelId;
    this.emitConfig();
  }
  async setModel(modelId: string): Promise<void> {
    await this.ready;
    await this.changeModel(modelId);
  }
  private async changeMode(modeId: string): Promise<void> {
    if (!this.modes.some((mode) => mode.id === modeId))
      throw new Error(
        `${this.provider.label} did not advertise mode ${modeId}.`,
      );
    await this.connection!.request(
      this.connection!.rpc.setSessionMode({
        sessionId: this.sessionId,
        modeId,
      }),
      "set mode",
    );
    this.modeId = modeId;
    this.emitConfig();
  }
  async setMode(modeId: string): Promise<void> {
    await this.ready;
    await this.changeMode(modeId);
  }
  setThinkingLevel(): Promise<never> {
    return Promise.reject(
      new Error(
        `${this.provider.label} does not expose reasoning settings through ACP.`,
      ),
    );
  }
  setAutoCompaction(): Promise<never> {
    return Promise.reject(
      new Error(
        `${this.provider.label} manages automatic compaction in its host configuration.`,
      ),
    );
  }
  setSessionName(): Promise<never> {
    return Promise.reject(
      new Error(
        `${this.provider.label} does not expose session renaming through ACP.`,
      ),
    );
  }
  async compact(customInstructions?: string): Promise<unknown> {
    await this.ready;
    if (customInstructions)
      throw new Error(
        `${this.provider.label} does not accept custom compaction instructions.`,
      );
    if (!this.provider.compactCommand)
      throw new Error(
        `${this.provider.label} does not expose compaction through ACP.`,
      );
    if (this.streaming)
      throw new Error("Wait for the active turn to finish before compacting.");
    this.compacting = true;
    this.emit({ type: "compaction_start" });
    try {
      return await this.prompt(this.provider.compactCommand);
    } catch (error) {
      this.compacting = false;
      this.emit({ type: "compaction_end" });
      throw error;
    }
  }

  private requestPermission(
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (this.stopped || this.loading || request.sessionId !== this.sessionId)
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    return new Promise((resolve) => {
      this.permissions.push({ id: `acp:${randomUUID()}`, request, resolve });
      if (this.permissions.length === 1) this.showPermission();
    });
  }
  private showPermission(): void {
    const pending = this.permissions[0];
    if (!pending) return;
    const { request, id } = pending;
    this.emit({
      type: "interaction_request",
      id,
      method: "select",
      approvalKind: "tool",
      title:
        request.toolCall.title ?? `${this.provider.label} needs permission`,
      toolDetail: { type: "json", value: toolDetails(request.toolCall) },
      approvalChoices: request.options.map((option) => ({
        value: option.optionId,
        label: option.name,
        kind: option.kind.startsWith("reject")
          ? "deny"
          : option.kind === "allow_once"
            ? "allow"
            : "always",
      })),
    });
  }
  respondToInteraction(
    id: string,
    response: Parameters<AgentRuntimeClient["respondToInteraction"]>[1],
  ): void {
    const pending = this.permissions[0];
    if (!pending || pending.id !== id) return;
    const value = response.value;
    const option = pending.request.options.find(
      (option) => option.optionId === value,
    );
    if (!response.cancelled && !option)
      throw new Error(
        "Select one of the permission options supplied by the agent.",
      );
    this.permissions.shift();
    pending.resolve(
      response.cancelled
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "selected", optionId: option!.optionId } },
    );
    this.emit({ type: "interaction_resolved", id });
    // Let the runtime finish resolving this card before exposing the next one.
    queueMicrotask(() => this.showPermission());
  }
  private cancelPermissions(): void {
    for (const pending of this.permissions.splice(0)) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
      this.emit({ type: "interaction_resolved", id: pending.id });
    }
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    this.cancelPermissions();
    this.stopPromise = (async () => {
      // Do not await a hung initialization before terminating its process.
      if (this.connection) await this.connection.stop();
      await this.ready.catch(() => {});
      await this.connection?.stop();
    })();
    return this.stopPromise;
  }
}
