import "server-only";
import type {
  AgentModel,
  AgentProviderId,
  AgentQueuedMessage,
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
  AgentRuntimeStatus,
  AgentSlashCommand,
  AgentSessionCommand,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import {
  applyAgentRuntimeMessageEvent,
  applyAgentRuntimeStateEvent,
} from "@/lib/agents/runtime/state";
import {
  agentProviderMetadata,
  isAgentProviderId,
} from "@/lib/agents/catalog";
import { agentProviderAdapter } from "@/lib/agents/providers/registry";
import type {
  AgentProviderAdapter,
  AgentRuntimeClient,
  AgentRuntimeEvent,
  AgentRuntimeEventClassifier,
  AgentRuntimeInitialState,
  AgentSessionForkResult,
} from "@/lib/agents/providers/types";
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
const PROVIDER_IDLE_POLL_MS = 100;
const PROVIDER_IDLE_TIMEOUT_MS = 30_000;

type Subscriber = (envelope: AgentRuntimeEnvelope) => void;

type RuntimeOwner = {
  userId: string;
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

export class AgentSessionRuntime {
  private readonly subscribers = new Set<Subscriber>();
  private readonly replay: AgentRuntimeEnvelope[] = [];
  private sequence = 0;
  private status: AgentRuntimeSnapshot["status"] = "idle";
  private activeTurnStartedAt: number | null = null;
  private state: Record<string, unknown>;
  private messages: unknown[];
  private models: AgentModel[];
  private thinkingLevels: AgentThinkingLevel[];
  private commands: AgentSlashCommand[];
  private stats: AgentSessionStats;
  private queuedMessages: AgentQueuedMessage[] = [];
  private nextQueuedMessageId = 0;
  private nextSubmissionId = 0;
  private promptAwaitingStart = false;
  private promptSubmissionId: string | undefined;
  private readonly pendingSubmissions = new Map<
    string,
    PendingSubmission
  >();
  private queueDrainPromise: Promise<void> | null = null;
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
    readonly userId: string,
    readonly connectionId: string,
    readonly workspaceId: string,
    private readonly adapter: AgentProviderAdapter,
    private readonly client: AgentRuntimeClient,
    initial: AgentRuntimeInitialState,
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
    this.activeTurnStartedAt =
      this.status === "running" ? Date.now() : null;
    this.scheduleIdleStop();

    client.onEvent((event) => {
      let settleRejectedPrompt = false;
      const classification = this.eventClassifier.classify(event);
      this.messages = applyAgentRuntimeMessageEvent(this.messages, event);
      this.state = applyAgentRuntimeStateEvent(this.state, event);
      if (
        ["message_start", "message_update", "message_end"].includes(
          event.type,
        ) &&
        messageRole(event.message) === "user"
      ) {
        const text = messageText(event.message);
        const submission = [...this.pendingSubmissions.values()].find(
          (candidate) => candidate.message.trim() === text,
        );
        if (submission) this.pendingSubmissions.delete(submission.id);
      }
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
        this.error = event.error;
        if (event.command === "prompt" && this.promptAwaitingStart) {
          this.promptAwaitingStart = false;
          const submission = this.promptSubmissionId
            ? this.pendingSubmissions.get(this.promptSubmissionId)
            : undefined;
          if (submission?.published) {
            this.rejectSubmission(submission.id);
          }
          if (this.promptSubmissionId) {
            this.pendingSubmissions.delete(this.promptSubmissionId);
          }
          this.promptSubmissionId = undefined;
          settleRejectedPrompt = true;
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
    return this.adapter.normalizeCommand(command, this.state);
  }

  command(input: AgentSessionCommand): Promise<unknown> {
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
        return this.submitPrompt(command.message);
      case "abort":
        return this.abortActiveRun();
      case "steer":
        return this.submitSteer(command.message);
      case "queue":
        return this.enqueueMessage(command.message);
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
    return this.client.forkSession(messageId, mode);
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
      this.activeTurnStartedAt =
        this.status === "running"
          ? (this.activeTurnStartedAt ?? Date.now())
          : null;
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
    if (this.stopped) return;
    this.stopped = true;
    this.turnGeneration += 1;
    this.clearIdleStop();
    this.clearPendingInteraction();
    try {
      await this.client.stop();
    } finally {
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

  private submitPrompt(message: string): Promise<unknown> {
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
    return this.startPrompt(message).finally(() => {
      if (this.status === "idle") void this.drainQueuedMessage();
    });
  }

  private async startPrompt(
    message: string,
    submissionId = `prompt:${++this.nextSubmissionId}`,
  ): Promise<unknown> {
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
      published: false,
    };
    this.pendingSubmissions.set(submission.id, submission);
    this.promptSubmissionId = submission.id;
    this.publishStatus();
    try {
      const result = await this.client.prompt(message);
      if (this.pendingSubmissions.get(submission.id) === submission) {
        submission.published = true;
        this.publishSubmission(submission.id, submission.message);
      }
      return result;
    } catch (error) {
      this.promptAwaitingStart = false;
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
    submissionId = `steer:${++this.nextSubmissionId}`,
  ): Promise<unknown> {
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

    const submission: PendingSubmission = {
      id: submissionId,
      message,
      published: false,
    };
    this.pendingSubmissions.set(submission.id, submission);
    const operation = this.client
      .steer(message)
      .then((result) => {
        if (this.pendingSubmissions.get(submission.id) === submission) {
          submission.published = true;
          this.publishSubmission(submission.id, submission.message);
        }
        return result;
      })
      .catch((error) => {
        if (this.pendingSubmissions.get(submission.id) === submission) {
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
        if (this.status === "idle") void this.drainQueuedMessage();
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

  private enqueueMessage(message: string): Promise<unknown> {
    const queuedMessage = this.addQueuedMessage(message, "pending");
    if (this.status === "idle") void this.drainQueuedMessage();
    return Promise.resolve({ queued: true, id: queuedMessage.id });
  }

  private addQueuedMessage(
    message: string,
    status: AgentQueuedMessage["status"],
  ): AgentQueuedMessage {
    const queuedMessage: AgentQueuedMessage = {
      id: `${this.dbSessionId}:${++this.nextQueuedMessageId}`,
      message,
      status,
    };
    this.queuedMessages = [...this.queuedMessages, queuedMessage];
    this.publishQueueUpdate();
    return queuedMessage;
  }

  private removeQueuedMessage(id: string): Promise<void> {
    const message = this.queuedMessages.find((item) => item.id === id);
    if (!message || message.status !== "pending") {
      return Promise.reject(
        new Error("That queued message is no longer editable."),
      );
    }
    this.deleteQueuedMessage(id);
    return Promise.resolve();
  }

  private steerQueuedMessage(id: string): Promise<unknown> {
    const message = this.queuedMessages.find((item) => item.id === id);
    if (!message || message.status !== "pending") {
      return Promise.reject(
        new Error("That queued message is no longer pending."),
      );
    }
    this.updateQueuedMessageStatus(id, "sending");
    return this.submitSteer(message.message, message.id)
      .then((result) => {
        this.deleteQueuedMessage(message.id);
        return result;
      })
      .catch((error) => {
        this.updateQueuedMessageStatus(message.id, "pending");
        throw error;
      });
  }

  private drainQueuedMessage(): Promise<void> {
    if (this.queueDrainPromise) return this.queueDrainPromise;
    if (
      this.status !== "idle" ||
      this.abortPromise ||
      this.settlePromise
    ) {
      return Promise.resolve();
    }
    const message = this.queuedMessages.find(
      (item) => item.status === "pending",
    );
    if (!message) return Promise.resolve();
    this.updateQueuedMessageStatus(message.id, "sending");
    const operation = this.startPrompt(message.message, message.id)
      .then(() => {
        this.deleteQueuedMessage(message.id);
      })
      .catch(() => {
        this.updateQueuedMessageStatus(message.id, "pending");
      });
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
  ): void {
    let changed = false;
    this.queuedMessages = this.queuedMessages.map((message) => {
      if (message.id !== id || message.status === status) return message;
      changed = true;
      return { ...message, status };
    });
    if (changed) this.publishQueueUpdate();
  }

  private deleteQueuedMessage(id: string): void {
    const next = this.queuedMessages.filter((message) => message.id !== id);
    if (next.length === this.queuedMessages.length) return;
    this.queuedMessages = next;
    this.publishQueueUpdate();
  }

  private publishSubmission(id: string, message: string): void {
    const event = {
      type: "overtchat_submission",
      message: {
        role: "user",
        content: message,
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

  private publishQueueUpdate(): void {
    this.publish({
      type: "runtime_event",
      data: {
        type: "overtchat_queue_update",
        queuedMessages: this.queuedMessages,
      },
    });
  }

  private publishSnapshot(): void {
    this.publish({ type: "snapshot", data: this.snapshot() });
  }

  private publish(
    envelope:
      | Omit<Extract<AgentRuntimeEnvelope, { type: "snapshot" }>, "sequence">
      | Omit<
          Extract<AgentRuntimeEnvelope, { type: "runtime_event" }>,
          "sequence"
        >,
  ): void {
    const sequenced =
      envelope.type === "snapshot"
        ? this.envelope("snapshot", envelope.data)
        : this.envelope("runtime_event", envelope.data);
    this.replay.push(sequenced);
    if (this.replay.length > MAX_REPLAY_EVENTS) this.replay.shift();
    for (const subscriber of this.subscribers) subscriber(sequenced);
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
      ? { sequence, type, data: data as AgentRuntimeSnapshot }
      : { sequence, type, data: data as AgentRuntimeEvent };
  }
}

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<string, AgentSessionRuntime>();
  private readonly starts = new Map<string, PendingRuntimeStart>();

  async getOrStart(owned: OwnedAgentSession): Promise<AgentSessionRuntime> {
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
  ): Promise<{ runtime: AgentSessionRuntime; sessionId: string }> {
    const adapter = this.adapterFor(owned.connection.provider);
    const client = adapter.startSession(
      targetForStoredHost(owned.host, owned.connection.shellMode),
      {
        executable: owned.connection.executable,
        cwd: owned.workspace.path,
      },
    );
    try {
      const initial = await this.loadInitial(adapter, client);
      const identity = adapter.sessionIdentity(initial.state);
      const row = await upsertAgentSession(owned.workspace.id, {
        providerSessionId: identity.providerSessionId,
        providerSessionPath: identity.providerSessionPath,
        name: identity.sessionName,
        firstMessage: null,
        messageCount: 0,
        createdAt: new Date(),
        modifiedAt: new Date(),
      });
      const runtime = this.register(
        row.id,
        owned,
        adapter,
        client,
        initial,
      );
      return { runtime, sessionId: row.id };
    } catch (error) {
      await client.stop();
      throw error;
    }
  }

  async fork(
    owned: OwnedAgentSession,
    runtime: AgentSessionRuntime,
    input: Extract<
      AgentSessionCommand,
      { type: "edit_message" | "fork_message" }
    >,
  ): Promise<{ sessionId: string; draft?: string }> {
    const fork = await runtime.forkSession(
      input.messageId,
      input.type === "edit_message" ? "edit" : "fork",
    );
    let row;
    try {
      row = await upsertAgentSession(owned.workspace.id, fork.session);
    } catch (error) {
      await runtime.discardForkedSession(fork.session).catch(() => {});
      throw error;
    }
    return {
      sessionId: row.id,
      ...(fork.draft !== undefined ? { draft: fork.draft } : {}),
    };
  }

  async getForUser(
    sessionId: string,
    userId: string,
  ): Promise<AgentSessionRuntime | null> {
    const owned = await getOwnedAgentSession(sessionId, userId);
    return owned ? this.getOrStart(owned) : null;
  }

  runtimeStatusForSession(
    sessionId: string,
    userId: string,
  ): AgentRuntimeStatus {
    const runtime = this.runtimes.get(sessionId);
    return runtime?.userId === userId ? runtime.snapshot().status : "idle";
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
  ): Promise<AgentSessionRuntime> {
    const adapter = this.adapterFor(owned.connection.provider);
    const client = adapter.startSession(
      targetForStoredHost(owned.host, owned.connection.shellMode),
      {
        executable: owned.connection.executable,
        cwd: owned.workspace.path,
        resume: {
          providerSessionId: owned.agentSession.providerSessionId,
          providerSessionPath: owned.agentSession.providerSessionPath,
        },
      },
    );
    try {
      const initial = await this.loadInitial(adapter, client);
      const identity = adapter.sessionIdentity(initial.state);
      if (
        identity.providerSessionId !==
        owned.agentSession.providerSessionId
      ) {
        throw new Error(
          `${agentProviderMetadata(adapter.provider).label} opened a different session than requested.`,
        );
      }
      return this.register(
        owned.agentSession.id,
        owned,
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
    owned: OwnedAgentWorkspace,
    adapter: AgentProviderAdapter,
    client: AgentRuntimeClient,
    initial: AgentRuntimeInitialState,
  ): AgentSessionRuntime {
    const runtime = new AgentSessionRuntime(
      sessionId,
      owned.host.userId,
      owned.connection.id,
      owned.workspace.id,
      adapter,
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

const globalForAgentRuntimes = globalThis as typeof globalThis & {
  overtchatAgentRuntimeRegistry?: AgentRuntimeRegistry;
};

export const agentRuntimeRegistry =
  globalForAgentRuntimes.overtchatAgentRuntimeRegistry ??
  new AgentRuntimeRegistry();

globalForAgentRuntimes.overtchatAgentRuntimeRegistry = agentRuntimeRegistry;
