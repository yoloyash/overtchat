import "server-only";
import type {
  AgentModel,
  AgentProviderId,
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
  AgentSlashCommand,
  AgentSessionCommand,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import { startPiRpc, type PiRpcClient } from "@/lib/agents/pi/client";
import {
  agentBuiltinCommands,
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "@/lib/agents/pi/commands";
import {
  parsePiCommands,
  parsePiQueueUpdate,
  type PiRpcEvent,
} from "@/lib/agents/pi/protocol";
import {
  agentProviderMetadata,
  isAgentProviderId,
} from "@/lib/agents/catalog";
import { targetForStoredHost } from "@/lib/agents/runtime/target";
import {
  getOwnedAgentSession,
  type OwnedAgentSession,
  type OwnedAgentWorkspace,
  updateAgentSessionMetadata,
  upsertAgentSession,
} from "@/lib/db/agentConnections";

const MAX_REPLAY_EVENTS = 500;
const MODEL_DISCOVERY_TIMEOUT_MS = 120_000;
const IDLE_RUNTIME_TTL_MS = 5 * 60_000;

type Subscriber = (envelope: AgentRuntimeEnvelope) => void;

type RuntimeOwner = {
  userId: string;
  connectionId: string;
  workspaceId: string;
};

type PendingRuntimeStart = RuntimeOwner & {
  promise: Promise<PiSessionRuntime>;
};

function emptyStats(): AgentSessionStats {
  return {
    sessionFile: null,
    sessionId: null,
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
}

function sessionIdentity(
  provider: AgentProviderId,
  state: Record<string, unknown>,
): {
  sessionFile: string;
  sessionId: string;
  sessionName: string | null;
} {
  const label = agentProviderMetadata(provider).label;
  const sessionFile = state.sessionFile;
  const sessionId = state.sessionId;
  if (typeof sessionFile !== "string" || !sessionFile) {
    throw new Error(`${label} did not create a persistent session file.`);
  }
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error(`${label} did not return a session ID.`);
  }
  return {
    sessionFile,
    sessionId,
    sessionName:
      typeof state.sessionName === "string" && state.sessionName.trim()
        ? state.sessionName.trim()
        : null,
  };
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = Reflect.get(message, "content");
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part) =>
        part &&
        typeof part === "object" &&
        Reflect.get(part, "type") === "text" &&
        typeof Reflect.get(part, "text") === "string",
    )
    .map((part) => Reflect.get(part, "text") as string)
    .join("\n")
    .trim();
}

function firstUserMessage(messages: unknown[]): string | null {
  for (const message of messages) {
    if (
      message &&
      typeof message === "object" &&
      Reflect.get(message, "role") === "user"
    ) {
      const text = messageText(message);
      if (text) return text;
    }
  }
  return null;
}

export class PiSessionRuntime {
  private readonly subscribers = new Set<Subscriber>();
  private readonly replay: AgentRuntimeEnvelope[] = [];
  private sequence = 0;
  private status: AgentRuntimeSnapshot["status"] = "idle";
  private state: Record<string, unknown>;
  private messages: unknown[];
  private models: AgentModel[];
  private thinkingLevels: AgentThinkingLevel[];
  private commands: AgentSlashCommand[];
  private stats: AgentSessionStats;
  private queuedMessages = {
    steering: [] as string[],
    followUp: [] as string[],
  };
  private pendingExtensionRequest:
    | NonNullable<AgentRuntimeSnapshot["pendingExtensionRequest"]>
    | undefined;
  private pendingExtensionTimer: NodeJS.Timeout | undefined;
  private error: string | undefined;
  private refreshPromise: Promise<void> | null = null;
  private idleStopTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly dbSessionId: string,
    readonly userId: string,
    readonly connectionId: string,
    readonly workspaceId: string,
    readonly provider: AgentProviderId,
    private readonly client: PiRpcClient,
    initial: {
      state: Record<string, unknown>;
      messages: unknown[];
      models: AgentModel[];
      thinkingLevels: AgentThinkingLevel[];
      commands: AgentSlashCommand[];
      stats: AgentSessionStats;
    },
    private readonly onExit: () => void,
  ) {
    this.state = initial.state;
    this.messages = initial.messages;
    this.models = initial.models;
    this.thinkingLevels = initial.thinkingLevels;
    this.commands = initial.commands;
    this.stats = initial.stats;
    this.status = initial.state.isStreaming === true ? "running" : "idle";
    this.scheduleIdleStop();

    client.onEvent((event) => {
      if (event.type === "process_exit") {
        this.clearIdleStop();
        this.clearPendingExtensionRequest();
        this.status = "exited";
        this.error =
          typeof event.error === "string"
            ? event.error
            : `${agentProviderMetadata(this.provider).label} exited.`;
        this.publishSnapshot();
        this.onExit();
        return;
      }
      if (event.type === "agent_start" || event.type === "turn_start") {
        this.status = "running";
      }
      if (
        event.type === "extension_ui_request" &&
        typeof event.id === "string" &&
        typeof event.method === "string" &&
        ["select", "confirm", "input", "editor"].includes(event.method)
      ) {
        this.clearPendingExtensionRequest();
        this.pendingExtensionRequest = event as NonNullable<
          AgentRuntimeSnapshot["pendingExtensionRequest"]
        >;
        if (
          typeof event.timeout === "number" &&
          Number.isFinite(event.timeout) &&
          event.timeout >= 0
        ) {
          const requestId = event.id;
          this.pendingExtensionTimer = setTimeout(() => {
            if (this.pendingExtensionRequest?.id !== requestId) return;
            this.pendingExtensionRequest = undefined;
            this.pendingExtensionTimer = undefined;
            this.publishSnapshot();
          }, event.timeout + 100);
        }
      }
      if (event.type === "queue_update") {
        const queuedMessages = parsePiQueueUpdate(event);
        if (queuedMessages) this.queuedMessages = queuedMessages;
      }
      this.publish({ type: "pi_event", data: event });
      if (
        event.type === "available_commands_update" &&
        Array.isArray(event.commands)
      ) {
        try {
          this.commands = mergeAgentSlashCommands(
            this.provider,
            parsePiCommands({ commands: event.commands }),
          );
          this.publishSnapshot();
        } catch {
          // A later refresh can recover if a newer provider adds metadata.
        }
      }
      if (
        event.type === "config_update" &&
        event.model &&
        typeof event.model === "object"
      ) {
        this.state = {
          ...this.state,
          model: event.model,
          ...(typeof event.thinkingLevel === "string"
            ? { thinkingLevel: event.thinkingLevel }
            : {}),
        };
        this.publishSnapshot();
      }
      if (
        event.type === "session_info_update" &&
        typeof event.title === "string"
      ) {
        this.state = { ...this.state, sessionName: event.title };
        void updateAgentSessionMetadata(this.dbSessionId, {
          name: event.title.trim() || null,
        });
        this.publishSnapshot();
      }
      if (
        event.type === "agent_settled" ||
        event.type === "agent_end"
      ) {
        this.clearPendingExtensionRequest();
        this.status = "idle";
        void this.refresh();
      } else if (
        event.type === "prompt_result" &&
        event.agentInvoked === false
      ) {
        this.status = "idle";
      }
    });
  }

  snapshot(): AgentRuntimeSnapshot {
    return {
      sessionId: this.dbSessionId,
      provider: this.provider,
      status: this.status,
      state: this.state,
      messages: this.messages,
      models: this.models,
      thinkingLevels: this.thinkingLevels,
      commands: this.commands,
      stats: this.stats,
      queuedMessages: this.queuedMessages,
      ...(this.pendingExtensionRequest
        ? { pendingExtensionRequest: this.pendingExtensionRequest }
        : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  subscribe(
    subscriber: Subscriber,
    afterSequence = 0,
  ): () => void {
    this.clearIdleStop();
    this.subscribers.add(subscriber);
    const replay = this.replay.filter(
      (envelope) => envelope.sequence > afterSequence,
    );
    if (replay.length > 0) {
      for (const envelope of replay) subscriber(envelope);
    } else {
      subscriber(this.envelope("snapshot", this.snapshot()));
    }
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.scheduleIdleStop();
    };
  }

  normalizeCommand(command: AgentSessionCommand): AgentSessionCommand {
    return normalizeAgentSessionCommand(
      this.provider,
      command,
      this.state,
    );
  }

  command(input: AgentSessionCommand): Promise<unknown> {
    const command = this.normalizeCommand(input);
    switch (command.type) {
      case "new_session":
        return Promise.reject(
          new Error("New sessions must be created by the runtime registry."),
        );
      case "prompt":
        return this.client.prompt(
          command.message,
          command.streamingBehavior,
        );
      case "abort":
        return this.client.abort();
      case "set_model":
        return this.client
          .setModel(command.provider, command.modelId)
          .then(async (value) => {
            await this.refresh();
            return value;
          });
      case "set_thinking_level":
        return this.client.setThinkingLevel(command.level).then(async (value) => {
          await this.refresh();
          return value;
        });
      case "compact":
        return this.client
          .compact(command.customInstructions)
          .then(async (value) => {
            await this.refresh();
            return value;
          });
      case "set_auto_compaction":
        return this.client
          .setAutoCompaction(command.enabled)
          .then(async (value) => {
            await this.refresh();
            return value;
          });
      case "set_session_name":
        return this.client.setSessionName(command.name).then(async (value) => {
          await this.refresh();
          return value;
        });
      case "extension_ui_response":
        this.client.respondToExtensionUi(command.id, {
          ...(command.value !== undefined ? { value: command.value } : {}),
          ...(command.confirmed !== undefined
            ? { confirmed: command.confirmed }
            : {}),
          ...(command.cancelled !== undefined
            ? { cancelled: command.cancelled }
            : {}),
        });
        if (this.pendingExtensionRequest?.id === command.id) {
          this.clearPendingExtensionRequest();
          this.publishSnapshot();
        }
        return Promise.resolve();
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const [state, messageData, stats, thinkingLevels, commands] =
        await Promise.all([
        this.client.getState(),
        this.client.getMessages(),
        this.client.getSessionStats().catch(() => emptyStats()),
          this.client
            .getAvailableThinkingLevels()
            .catch(() => this.thinkingLevels),
          this.client.getCommands().catch(() => this.commands),
        ]);
      this.state = state;
      this.messages = messageData.messages;
      this.stats = stats;
      this.thinkingLevels = thinkingLevels;
      this.commands = commands;
      this.status = state.isStreaming === true ? "running" : "idle";
      this.error = undefined;
      await updateAgentSessionMetadata(this.dbSessionId, {
        name:
          typeof state.sessionName === "string" && state.sessionName.trim()
            ? state.sessionName.trim()
            : null,
        firstMessage: firstUserMessage(this.messages),
        messageCount: this.messages.length,
      });
      this.publishSnapshot();
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async stop(): Promise<void> {
    this.clearIdleStop();
    this.clearPendingExtensionRequest();
    await this.client.stop();
  }

  private scheduleIdleStop(): void {
    this.clearIdleStop();
    this.idleStopTimer = setTimeout(() => {
      this.idleStopTimer = undefined;
      if (this.subscribers.size > 0) return;
      if (this.status === "running") {
        this.scheduleIdleStop();
        return;
      }
      void this.stop();
    }, IDLE_RUNTIME_TTL_MS);
    this.idleStopTimer.unref();
  }

  private clearIdleStop(): void {
    if (!this.idleStopTimer) return;
    clearTimeout(this.idleStopTimer);
    this.idleStopTimer = undefined;
  }

  private clearPendingExtensionRequest(): void {
    if (this.pendingExtensionTimer) {
      clearTimeout(this.pendingExtensionTimer);
      this.pendingExtensionTimer = undefined;
    }
    this.pendingExtensionRequest = undefined;
  }

  private publishSnapshot(): void {
    this.publish({ type: "snapshot", data: this.snapshot() });
  }

  private publish(
    envelope:
      | Omit<Extract<AgentRuntimeEnvelope, { type: "snapshot" }>, "sequence">
      | Omit<Extract<AgentRuntimeEnvelope, { type: "pi_event" }>, "sequence">,
  ): void {
    const sequenced =
      envelope.type === "snapshot"
        ? this.envelope("snapshot", envelope.data)
        : this.envelope("pi_event", envelope.data);
    this.replay.push(sequenced);
    if (this.replay.length > MAX_REPLAY_EVENTS) this.replay.shift();
    for (const subscriber of this.subscribers) subscriber(sequenced);
  }

  private envelope(
    type: "snapshot",
    data: AgentRuntimeSnapshot,
  ): AgentRuntimeEnvelope;
  private envelope(type: "pi_event", data: PiRpcEvent): AgentRuntimeEnvelope;
  private envelope(
    type: AgentRuntimeEnvelope["type"],
    data: AgentRuntimeSnapshot | PiRpcEvent,
  ): AgentRuntimeEnvelope {
    const sequence = ++this.sequence;
    return type === "snapshot"
      ? { sequence, type, data: data as AgentRuntimeSnapshot }
      : { sequence, type, data: data as PiRpcEvent };
  }
}

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<string, PiSessionRuntime>();
  private readonly starts = new Map<string, PendingRuntimeStart>();

  async getOrStart(owned: OwnedAgentSession): Promise<PiSessionRuntime> {
    const existing = this.runtimes.get(owned.agentSession.id);
    if (existing) return existing;
    const starting = this.starts.get(owned.agentSession.id);
    if (starting) return starting.promise;
    const promise = this.startExisting(owned).finally(() => {
      this.starts.delete(owned.agentSession.id);
    });
    this.starts.set(owned.agentSession.id, {
      userId: owned.host.userId,
      connectionId: owned.connection.id,
      workspaceId: owned.workspace.id,
      promise,
    });
    return promise;
  }

  async create(
    owned: OwnedAgentWorkspace,
  ): Promise<{ runtime: PiSessionRuntime; sessionId: string }> {
    const provider = this.providerFor(owned.connection.provider);
    const client = startPiRpc(targetForStoredHost(owned.host), {
      provider,
      executable: owned.connection.executable,
      cwd: owned.workspace.path,
    });
    try {
      const initial = await this.loadInitial(client);
      const identity = sessionIdentity(provider, initial.state);
      const row = await upsertAgentSession(owned.workspace.id, {
        providerSessionId: identity.sessionId,
        providerSessionPath: identity.sessionFile,
        name: identity.sessionName,
        firstMessage: null,
        messageCount: 0,
        createdAt: new Date(),
        modifiedAt: new Date(),
      });
      const runtime = this.register(row.id, owned, client, initial);
      return { runtime, sessionId: row.id };
    } catch (error) {
      await client.stop();
      throw error;
    }
  }

  async getForUser(
    sessionId: string,
    userId: string,
  ): Promise<PiSessionRuntime | null> {
    const owned = await getOwnedAgentSession(sessionId, userId);
    return owned ? this.getOrStart(owned) : null;
  }

  async stopWorkspace(workspaceId: string, userId: string): Promise<void> {
    await this.stopMatching(
      (runtime) =>
        runtime.workspaceId === workspaceId && runtime.userId === userId,
    );
  }

  async stopConnection(connectionId: string, userId: string): Promise<void> {
    await this.stopMatching(
      (runtime) =>
        runtime.connectionId === connectionId && runtime.userId === userId,
    );
  }

  async stopUser(userId: string): Promise<void> {
    await this.stopMatching((runtime) => runtime.userId === userId);
  }

  private async startExisting(
    owned: OwnedAgentSession,
  ): Promise<PiSessionRuntime> {
    const provider = this.providerFor(owned.connection.provider);
    const client = startPiRpc(targetForStoredHost(owned.host), {
      provider,
      executable: owned.connection.executable,
      cwd: owned.workspace.path,
      sessionPath: owned.agentSession.providerSessionPath,
    });
    try {
      const initial = await this.loadInitial(client);
      const identity = sessionIdentity(provider, initial.state);
      if (identity.sessionId !== owned.agentSession.providerSessionId) {
        throw new Error(
          `${agentProviderMetadata(provider).label} opened a different session than requested.`,
        );
      }
      return this.register(
        owned.agentSession.id,
        owned,
        client,
        initial,
      );
    } catch (error) {
      await client.stop();
      throw error;
    }
  }

  private register(
    sessionId: string,
    owned: OwnedAgentWorkspace,
    client: PiRpcClient,
    initial: {
      state: Record<string, unknown>;
      messages: unknown[];
      models: AgentModel[];
      thinkingLevels: AgentThinkingLevel[];
      commands: AgentSlashCommand[];
      stats: AgentSessionStats;
    },
  ): PiSessionRuntime {
    const runtime = new PiSessionRuntime(
      sessionId,
      owned.host.userId,
      owned.connection.id,
      owned.workspace.id,
      this.providerFor(owned.connection.provider),
      client,
      initial,
      () => {
        if (this.runtimes.get(sessionId) === runtime) {
          this.runtimes.delete(sessionId);
        }
      },
    );
    this.runtimes.set(sessionId, runtime);
    return runtime;
  }

  private async loadInitial(client: PiRpcClient) {
    const [state, messageData, models, stats, thinkingLevels, commands] =
      await Promise.all([
      client.getState(),
      client.getMessages(),
      client.getAvailableModels(MODEL_DISCOVERY_TIMEOUT_MS),
      client.getSessionStats().catch(() => emptyStats()),
        client.getAvailableThinkingLevels().catch(() => []),
        client
          .getCommands()
          .catch(() =>
            agentBuiltinCommands(client.provider).map((command) => ({
              ...command,
            })),
          ),
      ]);
    return {
      state,
      messages: messageData.messages,
      models,
      stats,
      thinkingLevels,
      commands,
    };
  }

  private providerFor(value: string): AgentProviderId {
    if (!isAgentProviderId(value)) {
      throw new Error(`Unsupported coding-agent provider "${value}".`);
    }
    return value;
  }

  private async stopMatching(
    predicate: (owner: RuntimeOwner) => boolean,
  ): Promise<void> {
    const matching = [...this.runtimes.values()].filter(predicate);
    const starting = [...this.starts.values()].filter(predicate);
    const startedWhileStopping = await Promise.allSettled(
      starting.map(({ promise }) => promise),
    );
    const newlyStarted = startedWhileStopping.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const all = [...new Set([...matching, ...newlyStarted])];
    await Promise.allSettled(all.map((runtime) => runtime.stop()));
    for (const runtime of all) {
      this.runtimes.delete(runtime.dbSessionId);
    }
  }
}

const globalForAgentRuntimes = globalThis as typeof globalThis & {
  overtchatAgentRuntimeRegistry?: AgentRuntimeRegistry;
};

export const agentRuntimeRegistry =
  globalForAgentRuntimes.overtchatAgentRuntimeRegistry ??
  new AgentRuntimeRegistry();

globalForAgentRuntimes.overtchatAgentRuntimeRegistry = agentRuntimeRegistry;
