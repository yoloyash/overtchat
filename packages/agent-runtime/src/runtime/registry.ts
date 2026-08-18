import type {
  AgentModel,
  AgentPromptImage,
  AgentProviderSessionMetadata,
  AgentProviderId,
  AgentQueuedMessage,
  AgentRuntimeCursor,
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
  AgentRuntimeStatus,
  AgentSlashCommand,
  AgentSessionCommand,
  AgentSessionSync,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@overtchat/agent-bridge";
import {
  applyAgentRuntimeMessageEvent,
  applyAgentRuntimeStateEvent,
  agentProviderMetadata,
  isAgentProviderId,
} from "@overtchat/agent-bridge";
import { agentProviderAdapter } from "@overtchat/agent-runtime/providers/registry";
import type {
  AgentProviderAdapter,
  AgentRuntimeClient,
  AgentRuntimeEvent,
  AgentRuntimeEventClassifier,
  AgentRuntimeInitialState,
  ResolvedAgentImage,
  AgentSessionForkResult,
} from "@overtchat/agent-runtime/providers/types";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";

const MAX_REPLAY_EVENTS = 500;
const MODEL_DISCOVERY_TIMEOUT_MS = 120_000;
const IDLE_RUNTIME_TTL_MS = 5 * 60_000;
const PROVIDER_IDLE_POLL_MS = 100;
const PROVIDER_IDLE_TIMEOUT_MS = 30_000;

type Subscriber = (envelope: AgentRuntimeEnvelope) => void;

type RuntimeOwner = {
  connectionId: string;
  workspaceId: string;
};

type PendingRuntimeStart = RuntimeOwner & {
  promise: Promise<AgentSessionRuntime>;
};

type PendingSubmission = {
  id: string;
  message: string;
  published: boolean;
  providerAcknowledged: boolean;
};

export type AgentWorkspaceDescriptor = RuntimeOwner & {
  provider: AgentProviderId;
  target: HostTarget;
  executable: string;
  cwd: string;
  detectedVersion?: string | null;
};

export type AgentSessionDescriptor = AgentWorkspaceDescriptor & {
  sessionId: string;
  providerSessionId: string;
  providerSessionPath: string;
};

export type AgentRuntimeMetadataPatch = {
  name?: string | null;
  firstMessage?: string | null;
  messageCount?: number;
  providerModifiedAt?: Date;
};

export type AgentRuntimeRegistryOptions = {
  resolveImages: (
    images: readonly AgentPromptImage[],
  ) => Promise<ResolvedAgentImage[]>;
  updateSessionMetadata?: (
    sessionId: string,
    patch: AgentRuntimeMetadataPatch,
  ) => void | Promise<void>;
  loadQueuedMessages?: (sessionId: string) => readonly AgentQueuedMessage[];
  saveQueuedMessages?: (
    sessionId: string,
    messages: readonly AgentQueuedMessage[],
  ) => void | Promise<void>;
  runtimeExited?: (
    sessionId: string,
    runtime: AgentSessionRuntime,
  ) => void | Promise<void>;
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
      const content = Reflect.get(message, "content");
      if (!Array.isArray(content)) continue;
      const image = content.find(
        (part) =>
          part &&
          typeof part === "object" &&
          Reflect.get(part, "type") === "image",
      );
      if (image) {
        const filename = Reflect.get(image, "filename");
        return typeof filename === "string" && filename.trim()
          ? filename.trim()
          : "Image attachment";
      }
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readOnlyState(
  state: Record<string, unknown>,
): AgentRuntimeSnapshot["readOnly"] {
  const value = state.readOnly;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const reason = Reflect.get(value, "reason");
  const retryable = Reflect.get(value, "retryable");
  return typeof reason === "string" && typeof retryable === "boolean"
    ? { reason, retryable }
    : undefined;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function messageRole(message: unknown): string | null {
  return message && typeof message === "object" &&
    typeof Reflect.get(message, "role") === "string"
    ? (Reflect.get(message, "role") as string)
    : null;
}

function messageSubmissionId(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const id = Reflect.get(message, "overtchatSubmissionId");
  return typeof id === "string" && id ? id : null;
}

function reconcileRestoredQueuedMessages(
  queuedMessages: readonly AgentQueuedMessage[],
  providerMessages: readonly unknown[],
): { messages: AgentQueuedMessage[]; changed: boolean } {
  const acceptedIds = new Set(
    providerMessages.flatMap((message) => {
      const id = messageSubmissionId(message);
      return id ? [id] : [];
    }),
  );
  let changed = false;
  const messages = queuedMessages.flatMap((message) => {
    if (message.status === "sending" || message.status === "uncertain") {
      if (acceptedIds.has(message.id)) {
        changed = true;
        return [];
      }
    }
    if (message.status === "sending") {
      changed = true;
      return [
        {
          ...message,
          status: "uncertain" as const,
          ...(message.images ? { images: [...message.images] } : {}),
        },
      ];
    }
    return [
      {
        ...message,
        ...(message.images ? { images: [...message.images] } : {}),
      },
    ];
  });
  return { messages, changed };
}

function eventUserMessages(event: AgentRuntimeEvent): unknown[] {
  if (Array.isArray(event.messages)) {
    return event.messages.filter((message) => messageRole(message) === "user");
  }
  return ["message_start", "message_update", "message_end"].includes(
    event.type,
  ) && messageRole(event.message) === "user"
    ? [event.message]
    : [];
}

export class AgentSessionRuntime {
  private readonly subscribers = new Set<Subscriber>();
  private readonly observers = new Set<Subscriber>();
  private leaseCount = 0;
  private readonly replay: AgentRuntimeEnvelope[] = [];
  private readonly epoch = crypto.randomUUID();
  private sequence = 0;
  private status: AgentRuntimeSnapshot["status"] = "idle";
  private activeTurnStartedAt: number | null = null;
  private state: Record<string, unknown>;
  private messages: unknown[];
  private models: AgentModel[];
  private thinkingLevels: AgentThinkingLevel[];
  private commands: AgentSlashCommand[];
  private stats: AgentSessionStats;
  private queuedMessages: AgentQueuedMessage[];
  private nextQueuedMessageId = 0;
  private nextSubmissionId = 0;
  private promptAwaitingStart = false;
  private promptSubmissionId: string | undefined;
  private readonly pendingSubmissions = new Map<
    string,
    PendingSubmission
  >();
  private queueDrainPromise: Promise<void> | null = null;
  private queuePersistenceTail: Promise<void> = Promise.resolve();
  private steerPromise: Promise<unknown> | null = null;
  private settlePromise: Promise<void> | null = null;
  private abortPromise: Promise<unknown> | null = null;
  private readonly eventClassifier: AgentRuntimeEventClassifier;
  private pendingInteraction:
    | NonNullable<AgentRuntimeSnapshot["pendingInteraction"]>
    | undefined;
  private pendingInteractionTimer: NodeJS.Timeout | undefined;
  private error: string | undefined;
  private refreshPromise: Promise<void> | null = null;
  private idleStopTimer: NodeJS.Timeout | undefined;
  private turnGeneration = 0;
  private stopped = false;
  private exitNotified = false;

  constructor(
    readonly dbSessionId: string,
    readonly connectionId: string,
    readonly workspaceId: string,
    private readonly adapter: AgentProviderAdapter,
    private readonly client: AgentRuntimeClient,
    initial: AgentRuntimeInitialState,
    private readonly resolveImages: AgentRuntimeRegistryOptions["resolveImages"],
    private readonly updateSessionMetadata: NonNullable<
      AgentRuntimeRegistryOptions["updateSessionMetadata"]
    >,
    private readonly saveQueuedMessages: NonNullable<
      AgentRuntimeRegistryOptions["saveQueuedMessages"]
    >,
    initialQueuedMessages: readonly AgentQueuedMessage[],
    private readonly onExit: () => void,
  ) {
    this.eventClassifier = adapter.createEventClassifier();
    this.state = initial.state;
    this.messages = initial.messages;
    this.models = initial.models;
    this.thinkingLevels = initial.thinkingLevels;
    this.commands = initial.commands;
    this.stats = initial.stats;
    this.status = initial.state.isStreaming === true ? "running" : "idle";
    const restoredQueue = reconcileRestoredQueuedMessages(
      initialQueuedMessages,
      initial.messages,
    );
    this.queuedMessages = restoredQueue.messages;
    this.activeTurnStartedAt =
      this.status === "running" ? Date.now() : null;
    this.scheduleIdleStop();
    if (
      restoredQueue.changed ||
      (this.queuedMessages.length > 0 && this.status === "idle")
    ) {
      queueMicrotask(() => {
        const ready = restoredQueue.changed
          ? this.publishQueueUpdate()
          : Promise.resolve();
        void ready
          .then(() => {
            if (this.status === "idle") return this.drainQueuedMessage();
          })
          .catch(() => {});
      });
    }

    client.onEvent((event) => {
      event = {
        ...event,
        // Give reducer-created rows one identity before this event touches
        // either the runtime projection or the connector timeline. Stamping
        // later at persistence would make a subsequent snapshot look like a
        // distinct command-output/tool row and duplicate it.
        overtchatRecordedAt:
          typeof event.overtchatRecordedAt === "number" &&
          Number.isFinite(event.overtchatRecordedAt)
            ? event.overtchatRecordedAt
            : Date.now(),
      };
      let settleRejectedPrompt = false;
      const classification = this.eventClassifier.classify(event);
      this.messages = applyAgentRuntimeMessageEvent(this.messages, event);
      this.state = applyAgentRuntimeStateEvent(this.state, event);
      const userMessages = eventUserMessages(event);
      for (const userMessage of userMessages) {
        const submissionId = messageSubmissionId(userMessage);
        const submission = submissionId
          ? this.pendingSubmissions.get(submissionId)
          : undefined;
        if (submission) submission.providerAcknowledged = true;
      }
      this.acknowledgeQueuedMessages(userMessages);
      if (event.type === "process_exit") {
        this.stopped = true;
        this.turnGeneration += 1;
        this.clearIdleStop();
        this.clearPendingInteraction();
        this.pendingSubmissions.clear();
        this.promptSubmissionId = undefined;
        this.status = "exited";
        this.activeTurnStartedAt = null;
        this.state = {
          ...this.state,
          isStreaming: false,
          isCompacting: false,
        };
        this.error =
          typeof event.error === "string"
            ? event.error
            : `${agentProviderMetadata(this.provider).label} exited.`;
        this.publishSnapshot();
        this.notifyExit();
        return;
      }
      if (classification.started) {
        this.promptAwaitingStart = false;
        this.status = "running";
        this.activeTurnStartedAt ??= Date.now();
        this.state = { ...this.state, isStreaming: true };
        this.error = undefined;
      }
      if (
        event.type === "interaction_request" &&
        typeof event.id === "string" &&
        typeof event.method === "string" &&
        ["select", "confirm", "input", "editor"].includes(event.method)
      ) {
        this.clearPendingInteraction();
        this.pendingInteraction = event as NonNullable<
          AgentRuntimeSnapshot["pendingInteraction"]
        >;
        if (
          typeof event.timeout === "number" &&
          Number.isFinite(event.timeout) &&
          event.timeout >= 0
        ) {
          const requestId = event.id;
          this.pendingInteractionTimer = setTimeout(() => {
            if (this.pendingInteraction?.id !== requestId) return;
            this.pendingInteraction = undefined;
            this.pendingInteractionTimer = undefined;
            this.publishSnapshot();
          }, event.timeout + 100);
        }
      }
      if (
        event.type === "interaction_resolved" &&
        typeof event.id === "string" &&
        this.pendingInteraction?.id === event.id
      ) {
        this.clearPendingInteraction();
      }
      if (
        event.type === "rpc_error" &&
        typeof event.error === "string"
      ) {
        if (event.command === "prompt" && this.promptAwaitingStart) {
          this.promptAwaitingStart = false;
          const submission = this.promptSubmissionId
            ? this.pendingSubmissions.get(this.promptSubmissionId)
            : undefined;
          if (submission?.providerAcknowledged) {
            this.pendingSubmissions.delete(submission.id);
          } else {
            this.error = event.error;
            if (submission?.published) {
              this.rejectSubmission(submission.id);
            }
            settleRejectedPrompt = true;
          }
          if (this.promptSubmissionId) {
            this.pendingSubmissions.delete(this.promptSubmissionId);
          }
          this.promptSubmissionId = undefined;
        } else {
          this.error = event.error;
        }
      }
      this.publish({ type: "runtime_event", data: event });
      if (settleRejectedPrompt) {
        void this.settleAfterProviderTerminal();
      }
      try {
        const commands = this.adapter.commandsFromEvent(event);
        if (commands) {
          this.commands = this.adapter.mergeCommands(commands);
          this.publishSnapshot();
        }
      } catch {
        // A later refresh can recover if a newer provider adds metadata.
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
          ...(typeof event.collaborationMode === "string"
            ? { collaborationMode: event.collaborationMode }
            : {}),
          ...(Array.isArray(event.collaborationModes)
            ? { collaborationModes: event.collaborationModes }
            : {}),
          ...(typeof event.fastModeEnabled === "boolean"
            ? { fastModeEnabled: event.fastModeEnabled }
            : {}),
          ...(typeof event.fastModeAvailable === "boolean"
            ? { fastModeAvailable: event.fastModeAvailable }
            : {}),
          ...(typeof event.modeId === "string"
            ? { modeId: event.modeId }
            : {}),
          ...(Array.isArray(event.modes)
            ? { modes: event.modes }
            : {}),
          ...(typeof event.goalsSupported === "boolean"
            ? { goalsSupported: event.goalsSupported }
            : {}),
          ...("goal" in event ? { goal: event.goal } : {}),
        };
        this.publishSnapshot();
      }
      if (
        event.type === "session_info_update" &&
        typeof event.title === "string"
      ) {
        this.state = { ...this.state, sessionName: event.title };
        void this.updateSessionMetadata(this.dbSessionId, {
          name: event.title.trim() || null,
        });
        this.publishSnapshot();
      }
      if (classification.terminal) {
        this.promptAwaitingStart = false;
        this.pendingSubmissions.clear();
        this.promptSubmissionId = undefined;
        this.clearPendingInteraction();
        void this.settleAfterProviderTerminal();
      }
    });
  }

  get provider(): AgentProviderId {
    return this.adapter.provider;
  }

  snapshot(): AgentRuntimeSnapshot {
    const readOnly = readOnlyState(this.state);
    return {
      sessionId: this.dbSessionId,
      provider: this.provider,
      capabilities: agentProviderMetadata(this.provider).capabilities,
      status: this.status,
      activeTurn:
        this.activeTurnStartedAt === null
          ? null
          : { startedAt: this.activeTurnStartedAt },
      state: this.state,
      messages: this.messages,
      models: this.models,
      thinkingLevels: this.thinkingLevels,
      commands: this.commands,
      stats: this.stats,
      queuedMessages: this.queuedMessages,
      ...(readOnly ? { readOnly } : {}),
      ...(this.pendingInteraction
        ? { pendingInteraction: this.pendingInteraction }
        : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  subscribe(
    subscriber: Subscriber,
    after?: AgentRuntimeCursor,
  ): () => void {
    this.clearIdleStop();
    this.subscribers.add(subscriber);
    const sync = this.sync(after);
    if (sync.reset) {
      // Compatibility delivery for servers that predate session-sync-v1. A
      // read-only snapshot uses the current head instead of consuming a
      // private sequence number and creating invisible gaps for other tabs.
      if (sync.cursor.sequence > 0) {
        subscriber({
          ...sync.cursor,
          type: "snapshot",
          data: sync.snapshot,
        });
      }
    } else {
      for (const envelope of sync.events) subscriber(envelope);
    }
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0 && this.leaseCount === 0) {
        this.scheduleIdleStop();
      }
    };
  }

  /** Passive connector capture; unlike a UI subscriber it does not affect the
   * runtime's idle lifetime or synthesize initial delivery. */
  observe(subscriber: Subscriber): () => void {
    this.observers.add(subscriber);
    return () => this.observers.delete(subscriber);
  }

  /** Hold the provider runtime open while an external durable-timeline
   * subscriber is attached. The connector owns delivery, but the runtime still
   * needs the same idle-lifetime semantics as a legacy direct subscriber. */
  acquireLease(): () => void {
    this.clearIdleStop();
    this.leaseCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leaseCount -= 1;
      if (this.subscribers.size === 0 && this.leaseCount === 0) {
        this.scheduleIdleStop();
      }
    };
  }

  sync(after?: AgentRuntimeCursor): AgentSessionSync {
    const cursor = { epoch: this.epoch, sequence: this.sequence };
    const reset = (): AgentSessionSync => ({
      reset: true,
      cursor,
      snapshot: this.snapshot(),
    });
    if (
      !after ||
      after.epoch !== this.epoch ||
      after.sequence > this.sequence
    ) {
      return reset();
    }
    if (after.sequence === this.sequence) {
      return { reset: false, cursor, events: [] };
    }
    const firstRetainedSequence = this.replay[0]?.sequence;
    if (
      firstRetainedSequence === undefined ||
      after.sequence < firstRetainedSequence - 1
    ) {
      return reset();
    }
    const events = this.replay.filter(
      (envelope) => envelope.sequence > after.sequence,
    );
    if (
      events[0]?.sequence !== after.sequence + 1 ||
      events.at(-1)?.sequence !== this.sequence
    ) {
      return reset();
    }
    return { reset: false, cursor, events };
  }

  normalizeCommand(command: AgentSessionCommand): AgentSessionCommand {
    return this.adapter.normalizeCommand(command, this.state);
  }

  command(
    input: AgentSessionCommand,
    clientMessageId?: string,
  ): Promise<unknown> {
    const command = this.normalizeCommand(input);
    const readOnly = readOnlyState(this.state);
    if (
      readOnly &&
      command.type !== "retry_interactive" &&
      command.type !== "show_usage"
    ) {
      return Promise.reject(new Error(readOnly.reason));
    }
    switch (command.type) {
      case "new_session":
        return Promise.reject(
          new Error("New sessions must be created by the runtime registry."),
        );
      case "edit_message":
      case "fork_message":
        return Promise.reject(
          new Error("Session forks must be created by the runtime registry."),
        );
      case "prompt":
        return this.submitPrompt(
          command.message,
          command.images ?? [],
          clientMessageId,
        );
      case "abort":
        return this.abortActiveRun();
      case "queue":
        return this.enqueueMessage(
          command.message,
          command.images ?? [],
          clientMessageId,
        );
      case "remove_queued_message":
        return this.removeQueuedMessage(command.id);
      case "steer_queued_message":
        return this.steerQueuedMessage(command.id);
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
      case "set_collaboration_mode":
        if (!this.client.setCollaborationMode) {
          return Promise.reject(
            new Error(
              `${agentProviderMetadata(this.provider).label} does not provide collaboration modes.`,
            ),
          );
        }
        return this.client
          .setCollaborationMode(command.mode)
          .then(async (value) => {
            await this.refresh();
            return value;
          });
      case "set_fast_mode":
        if (!this.client.setFastMode) {
          return Promise.reject(
            new Error(
              `${agentProviderMetadata(this.provider).label} does not provide fast mode.`,
            ),
          );
        }
        return this.client.setFastMode(command.enabled).then(async (value) => {
          await this.refresh();
          return value;
        });
      case "set_mode":
        if (!this.client.setMode) {
          return Promise.reject(
            new Error(
              `${agentProviderMetadata(this.provider).label} does not provide modes.`,
            ),
          );
        }
        return this.client.setMode(command.modeId).then(async (value) => {
          await this.refresh();
          return value;
        });
      case "update_goal":
        if (!this.client.updateGoal) {
          return Promise.reject(
            new Error(
              `${agentProviderMetadata(this.provider).label} does not provide durable goals.`,
            ),
          );
        }
        return this.client
          .updateGoal(command.action, command.objective)
          .then(async (value) => {
            await this.refresh();
            return value;
          });
      case "implement_plan":
        if (!this.client.setCollaborationMode) {
          return Promise.reject(
            new Error(
              `${agentProviderMetadata(this.provider).label} does not provide Plan mode.`,
            ),
          );
        }
        return this.client
          .setCollaborationMode("default")
          .then(() =>
            this.submitPrompt(
              [
                "The user approved the plan. Implement it now. Do not restate or revise the plan unless blocked.",
                ...(command.plan
                  ? [
                      "Approved plan:",
                      command.plan,
                      "Carry out the work, make the necessary code changes, and verify the result.",
                    ]
                  : ["Make the required code changes and verify them."]),
              ].join("\n\n"),
              [],
              clientMessageId,
            ),
          );
      case "compact":
        return this.client.compact(command.customInstructions);
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
      case "interaction_response": {
        const pendingInteraction = this.pendingInteraction;
        this.client.respondToInteraction(command.id, {
          ...(command.value !== undefined ? { value: command.value } : {}),
          ...(command.values !== undefined ? { values: command.values } : {}),
          ...(command.confirmed !== undefined
            ? { confirmed: command.confirmed }
            : {}),
          ...(command.cancelled !== undefined
            ? { cancelled: command.cancelled }
            : {}),
        });
        if (
          pendingInteraction?.id === command.id &&
          this.pendingInteraction === pendingInteraction
        ) {
          this.clearPendingInteraction();
          this.publishSnapshot();
        }
        return Promise.resolve();
      }
      case "retry_interactive":
        if (!this.client.retryInteractive) {
          return Promise.reject(
            new Error(
              `${agentProviderMetadata(this.provider).label} cannot retry interactive access.`,
            ),
          );
        }
        return this.client.retryInteractive().then(async (value) => {
          await this.refresh();
          return value;
        });
      case "show_usage":
        if (!this.client.getUsage) {
          return Promise.reject(
            new Error(
              `${agentProviderMetadata(this.provider).label} does not provide account usage.`,
            ),
          );
        }
        return this.client.getUsage();
    }
  }

  async forkSession(
    messageId: string,
    mode: "edit" | "fork",
  ): Promise<AgentSessionForkResult> {
    if (this.status !== "idle") {
      throw new Error("Wait for the current agent turn to finish first.");
    }
    if (this.pendingInteraction) {
      throw new Error("Respond to the pending agent request first.");
    }
    if (!this.client.forkSession) {
      throw new Error(
        `${agentProviderMetadata(this.provider).label} does not support conversation forks.`,
      );
    }
    const result = await this.client.forkSession(messageId, mode);
    if (result.replacesCurrentSession) await this.refresh();
    return result;
  }

  async discardForkedSession(
    session: AgentSessionForkResult["session"],
  ): Promise<void> {
    await this.client.discardForkedSession?.(session);
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
      this.commands = this.adapter.mergeCommands(commands);
      this.status = state.isStreaming === true ? "running" : "idle";
      const reconciledQueue = reconcileRestoredQueuedMessages(
        this.queuedMessages,
        this.messages,
      );
      if (reconciledQueue.changed) {
        this.queuedMessages = reconciledQueue.messages;
        await this.publishQueueUpdate();
      }
      this.activeTurnStartedAt =
        this.status === "running"
          ? (this.activeTurnStartedAt ?? Date.now())
          : null;
      this.error = undefined;
      await this.updateSessionMetadata(this.dbSessionId, {
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
    if (this.stopped) return;
    this.stopped = true;
    this.turnGeneration += 1;
    this.clearIdleStop();
    this.clearPendingInteraction();
    try {
      await this.client.stop();
    } finally {
      await this.flushQueuePersistence();
      if (this.status !== "exited") {
        this.status = "exited";
        this.activeTurnStartedAt = null;
        this.state = {
          ...this.state,
          isStreaming: false,
          isCompacting: false,
        };
        this.publishSnapshot();
      }
      this.notifyExit();
    }
  }

  private scheduleIdleStop(): void {
    this.clearIdleStop();
    this.idleStopTimer = setTimeout(() => {
      this.idleStopTimer = undefined;
      if (this.subscribers.size > 0 || this.leaseCount > 0) return;
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

  private async flushQueuePersistence(): Promise<void> {
    while (true) {
      const tail = this.queuePersistenceTail;
      await tail.catch(() => {});
      if (tail === this.queuePersistenceTail) return;
    }
  }

  private clearPendingInteraction(): void {
    if (this.pendingInteractionTimer) {
      clearTimeout(this.pendingInteractionTimer);
      this.pendingInteractionTimer = undefined;
    }
    this.pendingInteraction = undefined;
  }

  private notifyExit(): void {
    if (this.exitNotified) return;
    this.exitNotified = true;
    this.onExit();
  }

  private submitPrompt(
    message: string,
    images: AgentPromptImage[],
    clientMessageId?: string,
  ): Promise<unknown> {
    if (!message && images.length === 0) {
      return Promise.reject(new Error("Enter a message or attach an image."));
    }
    if (this.status === "exited") {
      return Promise.reject(
        new Error(`${agentProviderMetadata(this.provider).label} exited.`),
      );
    }
    if (
      this.status !== "idle" ||
      this.abortPromise ||
      this.settlePromise ||
      this.queueDrainPromise
    ) {
      const label = agentProviderMetadata(this.provider).label;
      return Promise.reject(
        new Error(
          agentProviderMetadata(this.provider).capabilities.steer
            ? `${label} is already working. Queue the message or steer the active turn.`
            : `${label} is already working. Queue the message instead.`,
        ),
      );
    }
    const imageInputError = this.imageInputError(images);
    if (imageInputError) return Promise.reject(imageInputError);
    return this.startPrompt(message, images, clientMessageId).finally(() => {
      if (this.status === "idle") void this.drainQueuedMessage();
    });
  }

  private async startPrompt(
    message: string,
    imageRefs: AgentPromptImage[],
    submissionId = `prompt:${++this.nextSubmissionId}`,
    onProviderInvoke?: () => void,
  ): Promise<unknown> {
    const images =
      imageRefs.length > 0
        ? await this.resolveImages(imageRefs)
        : [];
    this.turnGeneration += 1;
    this.eventClassifier.reset();
    this.status = "running";
    this.activeTurnStartedAt = Date.now();
    this.state = { ...this.state, isStreaming: true };
    this.error = undefined;
    this.promptAwaitingStart = true;
    const submission = {
      id: submissionId,
      message,
      published: true,
      providerAcknowledged: false,
    };
    this.pendingSubmissions.set(submission.id, submission);
    this.promptSubmissionId = submission.id;
    this.publishStatus();
    this.publishSubmission(submission.id, submission.message, images);
    try {
      onProviderInvoke?.();
      const result =
        images.length > 0
          ? await this.client.prompt(message, images, {
              clientMessageId: submissionId,
            })
          : await this.client.prompt(message, undefined, {
              clientMessageId: submissionId,
            });
      this.pendingSubmissions.delete(submission.id);
      if (this.promptSubmissionId === submission.id) {
        this.promptSubmissionId = undefined;
      }
      return result;
    } catch (error) {
      this.promptAwaitingStart = false;
      if (submission.providerAcknowledged) {
        this.pendingSubmissions.delete(submission.id);
        if (this.promptSubmissionId === submission.id) {
          this.promptSubmissionId = undefined;
        }
        return { accepted: true, providerAcknowledged: true };
      }
      if (this.pendingSubmissions.get(submission.id) === submission) {
        if (submission.published) this.rejectSubmission(submission.id);
        this.pendingSubmissions.delete(submission.id);
      }
      if (this.promptSubmissionId === submission.id) {
        this.promptSubmissionId = undefined;
      }
      this.status = "idle";
      this.activeTurnStartedAt = null;
      this.state = { ...this.state, isStreaming: false };
      this.error = errorMessage(error);
      this.publish({
        type: "runtime_event",
        data: {
          type: "rpc_error",
          command: "prompt",
          error: this.error,
        },
      });
      this.publishStatus();
      throw error;
    }
  }

  private submitSteer(
    message: string,
    imageRefs: AgentPromptImage[],
    submissionId = `steer:${++this.nextSubmissionId}`,
    onProviderInvoke?: () => void,
  ): Promise<unknown> {
    if (!message && imageRefs.length === 0) {
      return Promise.reject(new Error("Enter a message or attach an image."));
    }
    const metadata = agentProviderMetadata(this.provider);
    if (!metadata.capabilities.steer) {
      return Promise.reject(
        new Error(`${metadata.label} does not support steering.`),
      );
    }
    if (
      this.status !== "running" ||
      this.abortPromise ||
      this.settlePromise
    ) {
      return Promise.reject(
        new Error(`There is no active ${metadata.label} turn to steer.`),
      );
    }
    if (this.steerPromise) {
      return Promise.reject(
        new Error("Another steering message is already being submitted."),
      );
    }
    const imageInputError = this.imageInputError(imageRefs);
    if (imageInputError) return Promise.reject(imageInputError);

    const submit = (
      images: ResolvedAgentImage[],
    ) => {
      const submission: PendingSubmission = {
        id: submissionId,
        message,
        published: true,
        providerAcknowledged: false,
      };
      this.pendingSubmissions.set(submission.id, submission);
      this.publishSubmission(submission.id, submission.message, images);
      onProviderInvoke?.();
      const request =
        images.length > 0
          ? this.client.steer(message, images, {
              clientMessageId: submissionId,
            })
          : this.client.steer(message, undefined, {
              clientMessageId: submissionId,
            });
      return request.then((result) => {
        this.pendingSubmissions.delete(submission.id);
        return result;
      });
    };
    const operation = (
      imageRefs.length > 0
        ? this.resolveImages(imageRefs).then(submit)
        : submit([])
    )
      .catch((error) => {
        const submission = this.pendingSubmissions.get(submissionId);
        if (submission?.providerAcknowledged) {
          this.pendingSubmissions.delete(submission.id);
          return { accepted: true, providerAcknowledged: true };
        }
        if (submission) {
          if (submission.published) this.rejectSubmission(submission.id);
          this.pendingSubmissions.delete(submission.id);
        }
        this.error = errorMessage(error);
        this.publish({
          type: "runtime_event",
          data: {
            type: "rpc_error",
            command: "steer",
            error: this.error,
          },
        });
        throw error;
      });
    const settled = operation.finally(() => {
      if (this.steerPromise === settled) this.steerPromise = null;
    });
    this.steerPromise = settled;
    return settled;
  }

  private abortActiveRun(): Promise<unknown> {
    if (this.abortPromise) return this.abortPromise;
    if (this.status !== "running") {
      return Promise.resolve();
    }
    const operation = this.client.abort().then((result) => {
      this.completeAcknowledgedAbort();
      return result;
    });
    const settled = operation
      .catch((error) => {
        this.error = errorMessage(error);
        this.publish({
          type: "runtime_event",
          data: {
            type: "rpc_error",
            command: "abort",
            error: this.error,
          },
        });
        throw error;
      })
      .finally(() => {
        if (this.abortPromise !== settled) return;
        this.abortPromise = null;
        if (this.status === "idle") {
          void this.drainQueuedMessage();
        }
      });
    this.abortPromise = settled;
    return settled;
  }

  private completeAcknowledgedAbort(): void {
    // An acknowledged abort supersedes settlement work for the canceled turn.
    this.turnGeneration += 1;
    this.settlePromise = null;
    this.promptAwaitingStart = false;
    this.promptSubmissionId = undefined;
    this.pendingSubmissions.clear();
    this.clearPendingInteraction();
    this.eventClassifier.reset();
    this.status = "idle";
    this.activeTurnStartedAt = null;
    this.state = {
      ...this.state,
      isStreaming: false,
      isCompacting: false,
    };
    this.error = undefined;
    this.publishStatus();
  }

  private settleAfterProviderTerminal(): Promise<void> {
    if (this.abortPromise) return Promise.resolve();
    if (this.settlePromise) return this.settlePromise;
    const operation = this.reconcileProviderIdle(
      PROVIDER_IDLE_TIMEOUT_MS,
      this.turnGeneration,
    );
    const settled = operation
      .catch((error) => {
        this.error = errorMessage(error);
        this.publish({
          type: "runtime_event",
          data: {
            type: "rpc_error",
            command: "get_state",
            error: this.error,
          },
        });
      })
      .finally(() => {
        if (this.settlePromise !== settled) return;
        this.settlePromise = null;
        if (this.status === "idle") void this.drainQueuedMessage();
      });
    this.settlePromise = settled;
    return settled;
  }

  private async reconcileProviderIdle(
    timeoutMs: number,
    turnGeneration: number,
  ): Promise<void> {
    const providerIdle = await this.waitForProviderIdle(
      timeoutMs,
      turnGeneration,
    );
    if (!providerIdle) return;
    this.status = "idle";
    this.activeTurnStartedAt = null;
    this.state = {
      ...this.state,
      isStreaming: false,
      isCompacting: false,
    };
    try {
      await this.refresh();
    } catch (error) {
      this.error = errorMessage(error);
      this.publish({
        type: "runtime_event",
        data: {
          type: "rpc_error",
          command: "refresh",
          error: this.error,
        },
      });
      this.publishStatus();
    }
  }

  private async waitForProviderIdle(
    timeoutMs: number,
    turnGeneration: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (this.isProviderIdleWaitCurrent(turnGeneration)) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      try {
        const state = await this.client.getState(remainingMs);
        if (!this.isProviderIdleWaitCurrent(turnGeneration)) {
          return false;
        }
        this.state = state;
        if (state.isStreaming !== true && state.isCompacting !== true) {
          return true;
        }
      } catch (error) {
        lastError = error;
      }
      if (Date.now() >= deadline) break;
      await wait(PROVIDER_IDLE_POLL_MS);
    }
    if (!this.isProviderIdleWaitCurrent(turnGeneration)) {
      return false;
    }
    const detail = lastError ? ` ${errorMessage(lastError)}` : "";
    throw new Error(
      `${agentProviderMetadata(this.provider).label} still reports that it is working after ${Math.round(timeoutMs / 1_000)} seconds.${detail}`,
    );
  }

  private isProviderIdleWaitCurrent(turnGeneration: number): boolean {
    return (
      !this.stopped &&
      this.status !== "exited" &&
      this.turnGeneration === turnGeneration
    );
  }

  private publishStatus(): void {
    this.publish({
      type: "runtime_event",
      data: {
        type: "overtchat_status",
        status: this.status,
        startedAt: this.activeTurnStartedAt,
      },
    });
  }

  private imageInputError(images: AgentPromptImage[]): Error | null {
    if (images.length === 0) return null;
    const stateModel = this.state.model;
    const model =
      stateModel && typeof stateModel === "object" && !Array.isArray(stateModel)
        ? (stateModel as Record<string, unknown>)
        : null;
    const selected = this.models.find(
      (candidate) =>
        candidate.provider === model?.provider &&
        candidate.id === model?.id,
    );
    if (!selected?.input.includes("image")) {
      return new Error("The selected model does not support image input.");
    }
    return null;
  }

  private async enqueueMessage(
    message: string,
    images: AgentPromptImage[],
    clientMessageId?: string,
  ): Promise<unknown> {
    if (!message && images.length === 0) {
      return Promise.reject(new Error("Enter a message or attach an image."));
    }
    const imageInputError = this.imageInputError(images);
    if (imageInputError) return Promise.reject(imageInputError);
    const previousQueuedMessages = this.queuedMessages;
    const queuedMessage = this.addQueuedMessage(
      message,
      images,
      "pending",
      clientMessageId,
    );
    await this.persistQueueChange(previousQueuedMessages, true);
    if (this.status === "idle") void this.drainQueuedMessage();
    return { queued: true, id: queuedMessage.id };
  }

  private addQueuedMessage(
    message: string,
    images: AgentPromptImage[],
    status: AgentQueuedMessage["status"],
    id = `${this.dbSessionId}:${++this.nextQueuedMessageId}`,
  ): AgentQueuedMessage {
    const queuedMessage: AgentQueuedMessage = {
      id,
      message,
      ...(images.length > 0 ? { images } : {}),
      status,
    };
    this.queuedMessages = [...this.queuedMessages, queuedMessage];
    return queuedMessage;
  }

  private async removeQueuedMessage(id: string): Promise<void> {
    const message = this.queuedMessages.find((item) => item.id === id);
    if (
      !message ||
      (message.status !== "pending" && message.status !== "uncertain")
    ) {
      throw new Error("That queued message is no longer editable.");
    }
    await this.deleteQueuedMessage(id, true);
  }

  private async steerQueuedMessage(id: string): Promise<unknown> {
    const message = this.queuedMessages.find((item) => item.id === id);
    if (!message || message.status !== "pending") {
      throw new Error("That queued message is no longer pending.");
    }
    await this.updateQueuedMessageStatus(id, "sending");
    let result: unknown;
    let providerInvoked = false;
    try {
      result = await this.submitSteer(
        message.message,
        message.images ?? [],
        message.id,
        () => {
          providerInvoked = true;
        },
      );
    } catch (error) {
      await this.updateQueuedMessageStatus(
        message.id,
        providerInvoked ? "uncertain" : "pending",
        false,
      );
      throw error;
    }
    // A persistence failure here must not turn an accepted provider action
    // back into a replayable queue entry. A stable provider submission ID can
    // clear it later; otherwise restart recovery exposes it as uncertain.
    await this.deleteQueuedMessage(message.id);
    return result;
  }

  private drainQueuedMessage(): Promise<void> {
    if (this.queueDrainPromise) return this.queueDrainPromise;
    if (
      this.status !== "idle" ||
      this.abortPromise ||
      this.settlePromise ||
      this.queuedMessages.some(
        (message) =>
          message.status === "sending" || message.status === "uncertain",
      )
    ) {
      return Promise.resolve();
    }
    const message = this.queuedMessages.find(
      (item) => item.status === "pending",
    );
    if (!message) return Promise.resolve();
    const operation = (async () => {
      try {
        // Commit the at-most-once boundary before asking the provider to act.
        await this.updateQueuedMessageStatus(message.id, "sending");
      } catch {
        return;
      }
      let providerInvoked = false;
      try {
        await this.startPrompt(
          message.message,
          message.images ?? [],
          message.id,
          () => {
            providerInvoked = true;
          },
        );
      } catch {
        await this.updateQueuedMessageStatus(
          message.id,
          providerInvoked ? "uncertain" : "pending",
          false,
        ).catch(() => {});
        return;
      }
      await this.deleteQueuedMessage(message.id).catch(() => {});
    })();
    const settled = operation.finally(() => {
      if (this.queueDrainPromise === settled) {
        this.queueDrainPromise = null;
      }
    });
    this.queueDrainPromise = settled;
    return settled;
  }

  private updateQueuedMessageStatus(
    id: string,
    status: AgentQueuedMessage["status"],
    rollbackOnFailure = true,
  ): Promise<void> {
    const previousQueuedMessages = this.queuedMessages;
    let changed = false;
    this.queuedMessages = this.queuedMessages.map((message) => {
      if (message.id !== id || message.status === status) return message;
      changed = true;
      return { ...message, status };
    });
    return changed
      ? this.persistQueueChange(previousQueuedMessages, rollbackOnFailure)
      : Promise.resolve();
  }

  private deleteQueuedMessage(
    id: string,
    rollbackOnFailure = false,
  ): Promise<void> {
    const previousQueuedMessages = this.queuedMessages;
    const next = this.queuedMessages.filter((message) => message.id !== id);
    if (next.length === this.queuedMessages.length) return Promise.resolve();
    this.queuedMessages = next;
    return this.persistQueueChange(previousQueuedMessages, rollbackOnFailure);
  }

  private async persistQueueChange(
    previousQueuedMessages: AgentQueuedMessage[],
    rollbackOnFailure: boolean,
  ): Promise<void> {
    const nextQueuedMessages = this.queuedMessages;
    try {
      await this.publishQueueUpdate();
    } catch (error) {
      if (rollbackOnFailure && this.queuedMessages === nextQueuedMessages) {
        this.queuedMessages = previousQueuedMessages;
      }
      throw error;
    }
  }

  private acknowledgeQueuedMessages(userMessages: readonly unknown[]): void {
    const acknowledged = new Set<string>();
    for (const userMessage of userMessages) {
      const submissionId = messageSubmissionId(userMessage);
      if (
        submissionId &&
        this.queuedMessages.some(
          (message) =>
            (message.status === "sending" ||
              message.status === "uncertain") &&
            message.id === submissionId,
        )
      ) {
        acknowledged.add(submissionId);
      }
    }
    for (const id of acknowledged) {
      void this.deleteQueuedMessage(id).catch(() => {});
    }
  }

  private publishSubmission(
    id: string,
    message: string,
    images: ResolvedAgentImage[],
  ): void {
    const content =
      images.length === 0
        ? message
        : [
            ...(message ? [{ type: "text", text: message }] : []),
            ...images.map((image) => ({
              type: "image",
              url: `/api/uploads/${image.uploadId}`,
              mimeType: image.mediaType,
              filename: image.filename,
            })),
          ];
    const event = {
      type: "overtchat_submission",
      message: {
        role: "user",
        content,
        timestamp: Date.now(),
        overtchatSubmissionId: id,
      },
    };
    this.messages = applyAgentRuntimeMessageEvent(this.messages, event);
    this.publish({ type: "runtime_event", data: event });
  }

  private rejectSubmission(id: string): void {
    const event = {
      type: "overtchat_submission_rejected",
      id,
    };
    this.messages = applyAgentRuntimeMessageEvent(this.messages, event);
    this.publish({ type: "runtime_event", data: event });
  }

  private publishQueueUpdate(): Promise<void> {
    const queuedMessages = this.queuedMessages.map((message) => ({
      ...message,
      ...(message.images ? { images: [...message.images] } : {}),
    }));
    const operation = this.queuePersistenceTail.then(() =>
      this.saveQueuedMessages(this.dbSessionId, queuedMessages),
    );
    this.queuePersistenceTail = operation.catch((error) => {
      this.error = `Unable to persist queued messages: ${errorMessage(error)}`;
      this.publish({
        type: "runtime_event",
        data: {
          type: "rpc_error",
          command: "queue",
          error: this.error,
        },
      });
    });
    return operation.then(() => {
      this.publish({
        type: "runtime_event",
        data: {
          type: "overtchat_queue_update",
          queuedMessages,
        },
      });
    });
  }

  private publishSnapshot(): void {
    this.publish({ type: "snapshot", data: this.snapshot() });
  }

  private publish(
    envelope:
      | Omit<
          Extract<AgentRuntimeEnvelope, { type: "snapshot" }>,
          "epoch" | "sequence"
        >
      | Omit<
          Extract<AgentRuntimeEnvelope, { type: "runtime_event" }>,
          "epoch" | "sequence"
        >,
  ): void {
    const sequenced =
      envelope.type === "snapshot"
        ? this.envelope("snapshot", envelope.data)
        : this.envelope("runtime_event", envelope.data);
    this.replay.push(sequenced);
    if (this.replay.length > MAX_REPLAY_EVENTS) this.replay.shift();
    for (const subscriber of this.subscribers) subscriber(sequenced);
    for (const observer of this.observers) observer(sequenced);
  }

  private envelope(
    type: "snapshot",
    data: AgentRuntimeSnapshot,
  ): AgentRuntimeEnvelope;
  private envelope(
    type: "runtime_event",
    data: AgentRuntimeEvent,
  ): AgentRuntimeEnvelope;
  private envelope(
    type: AgentRuntimeEnvelope["type"],
    data: AgentRuntimeSnapshot | AgentRuntimeEvent,
  ): AgentRuntimeEnvelope {
    const sequence = ++this.sequence;
    return type === "snapshot"
      ? { epoch: this.epoch, sequence, type, data: data as AgentRuntimeSnapshot }
      : { epoch: this.epoch, sequence, type, data: data as AgentRuntimeEvent };
  }
}

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<string, AgentSessionRuntime>();
  private readonly starts = new Map<string, PendingRuntimeStart>();

  constructor(private readonly options: AgentRuntimeRegistryOptions) {}

  get(sessionId: string): AgentSessionRuntime | null {
    return this.runtimes.get(sessionId) ?? null;
  }

  async getOrStart(
    descriptor: AgentSessionDescriptor,
  ): Promise<AgentSessionRuntime> {
    const existing = this.runtimes.get(descriptor.sessionId);
    if (existing) return existing;
    const starting = this.starts.get(descriptor.sessionId);
    if (starting) return starting.promise;
    const promise = this.startExisting(descriptor).finally(() => {
      this.starts.delete(descriptor.sessionId);
    });
    this.starts.set(descriptor.sessionId, {
      connectionId: descriptor.connectionId,
      workspaceId: descriptor.workspaceId,
      promise,
    });
    return promise;
  }

  async create(
    sessionId: string,
    descriptor: AgentWorkspaceDescriptor,
  ): Promise<{
    runtime: AgentSessionRuntime;
    session: AgentProviderSessionMetadata;
  }> {
    const adapter = this.adapterFor(descriptor.provider);
    const client = adapter.startSession(descriptor.target, {
      executable: descriptor.executable,
      cwd: descriptor.cwd,
      detectedVersion: descriptor.detectedVersion,
    });
    try {
      const initial = await this.loadInitial(adapter, client);
      const identity = adapter.sessionIdentity(initial.state);
      const session: AgentProviderSessionMetadata = {
        providerSessionId: identity.providerSessionId,
        providerSessionPath: identity.providerSessionPath,
        name: identity.sessionName,
        firstMessage: null,
        messageCount: 0,
        createdAt: new Date(),
        modifiedAt: new Date(),
      };
      const runtime = this.register(
        sessionId,
        descriptor,
        adapter,
        client,
        initial,
      );
      return { runtime, session };
    } catch (error) {
      await client.stop();
      throw error;
    }
  }

  async fork(
    runtime: AgentSessionRuntime,
    input: Extract<
      AgentSessionCommand,
      { type: "edit_message" | "fork_message" }
    >,
  ): Promise<AgentSessionForkResult> {
    const fork = await runtime.forkSession(
      input.messageId,
      input.type === "edit_message" ? "edit" : "fork",
    );
    return fork;
  }

  runtimeStatusForSession(sessionId: string): AgentRuntimeStatus {
    return this.runtimes.get(sessionId)?.snapshot().status ?? "idle";
  }

  async stopSession(sessionId: string): Promise<void> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;
    await runtime.stop();
    this.runtimes.delete(sessionId);
  }

  async stopWorkspace(workspaceId: string): Promise<void> {
    await this.stopMatching((runtime) => runtime.workspaceId === workspaceId);
  }

  async stopConnection(connectionId: string): Promise<void> {
    await this.stopMatching((runtime) => runtime.connectionId === connectionId);
  }

  async stopAll(): Promise<void> {
    await this.stopMatching(() => true);
  }

  private async startExisting(
    descriptor: AgentSessionDescriptor,
  ): Promise<AgentSessionRuntime> {
    const adapter = this.adapterFor(descriptor.provider);
    const client = adapter.startSession(descriptor.target, {
      executable: descriptor.executable,
      cwd: descriptor.cwd,
      detectedVersion: descriptor.detectedVersion,
      resume: {
        providerSessionId: descriptor.providerSessionId,
        providerSessionPath: descriptor.providerSessionPath,
      },
    });
    try {
      const initial = await this.loadInitial(adapter, client);
      const identity = adapter.sessionIdentity(initial.state);
      if (
        identity.providerSessionId !== descriptor.providerSessionId
      ) {
        throw new Error(
          `${agentProviderMetadata(adapter.provider).label} opened a different session than requested.`,
        );
      }
      return this.register(
        descriptor.sessionId,
        descriptor,
        adapter,
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
    descriptor: AgentWorkspaceDescriptor,
    adapter: AgentProviderAdapter,
    client: AgentRuntimeClient,
    initial: AgentRuntimeInitialState,
  ): AgentSessionRuntime {
    const runtime = new AgentSessionRuntime(
      sessionId,
      descriptor.connectionId,
      descriptor.workspaceId,
      adapter,
      client,
      initial,
      this.options.resolveImages,
      this.options.updateSessionMetadata ?? (() => {}),
      this.options.saveQueuedMessages ?? (() => {}),
      this.options.loadQueuedMessages?.(sessionId) ?? [],
      () => {
        if (this.runtimes.get(sessionId) === runtime) {
          this.runtimes.delete(sessionId);
        }
        void this.options.runtimeExited?.(sessionId, runtime);
      },
    );
    this.runtimes.set(sessionId, runtime);
    return runtime;
  }

  private async loadInitial(
    adapter: AgentProviderAdapter,
    client: AgentRuntimeClient,
  ): Promise<AgentRuntimeInitialState> {
    const [state, messageData, models, stats, thinkingLevels, commands] =
      await Promise.all([
        client.getState(),
        client.getMessages(),
        client.getAvailableModels(MODEL_DISCOVERY_TIMEOUT_MS),
        client.getSessionStats().catch(() => emptyStats()),
        client.getAvailableThinkingLevels().catch(() => []),
        client
          .getCommands()
          .then((commands) => adapter.mergeCommands(commands))
          .catch(() => adapter.mergeCommands([])),
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

  private adapterFor(value: string): AgentProviderAdapter {
    if (!isAgentProviderId(value)) {
      throw new Error(`Unsupported coding-agent provider "${value}".`);
    }
    return agentProviderAdapter(value);
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
