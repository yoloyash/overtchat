import { AgentIdleNotifications } from "@/lib/notifications/agentIdle";
import { notifyAgentIdle } from "@/lib/notifications/sender";
import "server-only";
import {
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isAgentSessionSync,
  isAgentWorkspaceGitStatus,
  isConnectorSshHost,
  sameAgentSessionDirectoryEntry,
  type AgentDaemonRequest,
  type AgentDaemonSessionDescriptor,
  type AgentDaemonTarget,
  type AgentRuntimeEnvelope,
  type AgentSessionDirectoryEntry,
  type AgentSessionSync,
  type AgentWorkspaceGitStatus,
  type ConnectorSshHost,
  type HostConnectorCommand,
  type HostConnectorCapability,
  type HostConnectorEvent,
  type HostConnectorEventAck,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import {
  recordAgentSessionLastTurn,
  updateAgentSessionMetadata,
} from "@/lib/db/agentConnections";

const REQUEST_TIMEOUT_MS = 180_000;
const CONNECTOR_DISCONNECT_GRACE_MS = 5_000;
/** Absorbs navigation and stream reconnects without restarting host watchers. */
const GIT_WATCH_RELEASE_MS = 15_000;

type Channel = {
  send: (command: HostConnectorCommand) => void;
  capabilities: Set<HostConnectorCapability>;
  sessionIds: Set<string>;
};

type PendingRequest = {
  connectorId: string;
  request: AgentDaemonRequest;
  replaySafe: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

function isLedgerProtectedCommand(request: AgentDaemonRequest): boolean {
  return (
    request.type === "session_command" && request.command.type !== "show_usage"
  );
}

function sessionIdForRequest(request: AgentDaemonRequest): string | undefined {
  switch (request.type) {
    case "create_session":
    case "stop_session":
      return request.sessionId;
    case "open_session":
    case "session_history":
    case "session_command":
    case "subscribe_session":
      return request.session.sessionId;
    default:
      return undefined;
  }
}

type SessionSubscription = {
  connectorId: string;
  session: AgentDaemonSessionDescriptor;
  authoritative: boolean;
  initialized: boolean;
  after?: { epoch: string; sequence: number };
  subscriber: (envelope: AgentRuntimeEnvelope) => void;
  synchronize: (sync: AgentSessionSync) => void;
  disconnect: (error: Error) => void;
  replayBuffer: AgentRuntimeEnvelope[] | null;
};

export type AgentSessionDirectoryEvent =
  | { type: "snapshot"; sessions: AgentSessionDirectoryEntry[] }
  | { type: "update"; session: AgentSessionDirectoryEntry };

type SessionDirectorySubscription = {
  sessionIds: Set<string>;
  subscriber: (event: AgentSessionDirectoryEvent) => void;
};

/** `live` tells clients whether pushed statuses replace their polling. */
export type AgentWorkspaceGitEvent =
  | { type: "live"; live: boolean }
  | { type: "status"; status: AgentWorkspaceGitStatus };

export type AgentWorkspaceGitWatchTarget = {
  connectorId: string;
  workspaceId: string;
  target: AgentDaemonTarget;
  path: string;
};

type WorkspaceGitWatch = AgentWorkspaceGitWatchTarget & {
  key: string;
  watchId: string;
  listeners: Set<(event: AgentWorkspaceGitEvent) => void>;
  status: AgentWorkspaceGitStatus | null;
  revision: number;
  live: boolean;
  generation: number;
  releaseTimer?: NodeJS.Timeout;
};

export class HostConnectorBroker {
  private readonly channels = new Map<string, Channel>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, SessionSubscription>();
  private readonly notificationSequences = new Map<
    string,
    Map<string, number>
  >();
  private readonly idleNotifications = new AgentIdleNotifications((id) => {
    void notifyAgentIdle(id).catch(() =>
      console.error("[push] Could not send agent notification."),
    );
  });
  private readonly sessionDirectory = new Map<
    string,
    { connectorId: string; session: AgentSessionDirectoryEntry }
  >();
  private readonly directorySubscriptions =
    new Set<SessionDirectorySubscription>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly gitWatches = new Map<string, WorkspaceGitWatch>();
  private readonly gitWatchIds = new Map<string, WorkspaceGitWatch>();

  constructor(
    private readonly disconnectGraceMs = CONNECTOR_DISCONNECT_GRACE_MS,
    private readonly gitWatchReleaseMs = GIT_WATCH_RELEASE_MS,
  ) {}

  isOnline(connectorId: string): boolean {
    return this.channels.has(connectorId);
  }

  supports(connectorId: string, capability: HostConnectorCapability): boolean {
    return (
      this.channels.get(connectorId)?.capabilities.has(capability) ?? false
    );
  }

  runtimeStatusForSession(
    sessionId: string,
  ): AgentSessionDirectoryEntry["runtimeStatus"] {
    return this.sessionDirectoryEntry(sessionId).runtimeStatus;
  }

  sessionDirectoryEntry(sessionId: string): AgentSessionDirectoryEntry {
    return (
      this.sessionDirectory.get(sessionId)?.session ?? {
        sessionId,
        runtimeStatus: "idle",
      }
    );
  }

  subscribeSessionDirectory(
    sessionIds: Iterable<string>,
    subscriber: (event: AgentSessionDirectoryEvent) => void,
  ): () => void {
    const subscription = {
      sessionIds: new Set(sessionIds),
      subscriber,
    };
    this.directorySubscriptions.add(subscription);
    subscriber({
      type: "snapshot",
      sessions: [...subscription.sessionIds].map((sessionId) =>
        this.sessionDirectoryEntry(sessionId),
      ),
    });
    return () => {
      this.directorySubscriptions.delete(subscription);
    };
  }

  /**
   * Shares one connector watch per workspace between every listener. Each
   * listener first receives the current live flag and status, then changes.
   */
  watchWorkspaceGit(
    target: AgentWorkspaceGitWatchTarget,
    listener: (event: AgentWorkspaceGitEvent) => void,
  ): () => void {
    const key = `${target.connectorId}\0${target.workspaceId}`;
    let watch = this.gitWatches.get(key);
    if (!watch) {
      watch = {
        ...target,
        key,
        watchId: crypto.randomUUID(),
        listeners: new Set(),
        status: null,
        revision: -1,
        live: false,
        generation: 0,
      };
      this.gitWatches.set(key, watch);
      this.gitWatchIds.set(watch.watchId, watch);
      this.startGitWatch(watch);
    }
    const current = watch;
    if (current.releaseTimer) clearTimeout(current.releaseTimer);
    current.releaseTimer = undefined;
    current.listeners.add(listener);
    listener({ type: "live", live: current.live });
    if (current.live && current.status) {
      listener({ type: "status", status: current.status });
    }
    return () => {
      if (!current.listeners.delete(listener) || current.listeners.size > 0) {
        return;
      }
      current.releaseTimer = setTimeout(
        () => this.releaseGitWatch(current),
        this.gitWatchReleaseMs,
      );
      current.releaseTimer.unref();
    };
  }

  /** The pushed status, when a live watch already knows it. */
  workspaceGitStatus(
    connectorId: string,
    workspaceId: string,
  ): AgentWorkspaceGitStatus | null {
    const watch = this.gitWatches.get(`${connectorId}\0${workspaceId}`);
    return watch?.live ? watch.status : null;
  }

  private startGitWatch(watch: WorkspaceGitWatch): void {
    if (!this.supports(watch.connectorId, "workspace-git-watch-v1")) return;
    const generation = ++watch.generation;
    const current = () =>
      this.gitWatches.get(watch.key) === watch &&
      watch.generation === generation;
    this.request<{ status?: unknown; revision?: unknown }>(watch.connectorId, {
      type: "watch_git_status",
      watchId: watch.watchId,
      target: watch.target,
      path: watch.path,
    }).then(
      (result) => {
        if (!current()) return;
        const revision = Number(result?.revision);
        if (
          isAgentWorkspaceGitStatus(result?.status) &&
          Number.isSafeInteger(revision) &&
          revision >= watch.revision
        ) {
          watch.status = result.status;
          watch.revision = revision;
        }
        this.setGitWatchLive(watch, true);
        if (watch.status) {
          this.notifyGitWatch(watch, { type: "status", status: watch.status });
        }
      },
      () => {
        // Listeners keep polling; the next connector registration retries.
        if (current()) this.setGitWatchLive(watch, false);
      },
    );
  }

  private releaseGitWatch(watch: WorkspaceGitWatch): void {
    watch.releaseTimer = undefined;
    if (watch.listeners.size > 0 || this.gitWatches.get(watch.key) !== watch) {
      return;
    }
    this.gitWatches.delete(watch.key);
    this.gitWatchIds.delete(watch.watchId);
    watch.generation += 1;
    if (!this.supports(watch.connectorId, "workspace-git-watch-v1")) return;
    void this.request(watch.connectorId, {
      type: "unwatch_git_status",
      watchId: watch.watchId,
    }).catch(() => {});
  }

  private setGitWatchLive(watch: WorkspaceGitWatch, live: boolean): void {
    if (watch.live === live) return;
    watch.live = live;
    if (!live) {
      watch.status = null;
      watch.revision = -1;
    }
    this.notifyGitWatch(watch, { type: "live", live });
  }

  private notifyGitWatch(
    watch: WorkspaceGitWatch,
    event: AgentWorkspaceGitEvent,
  ): void {
    for (const listener of [...watch.listeners]) listener(event);
  }

  replaceSessionProviderSession(
    connectorId: string,
    sessionId: string,
    providerSession: Pick<
      AgentDaemonSessionDescriptor,
      "providerSessionId" | "providerSessionPath"
    >,
  ): void {
    for (const subscription of this.subscriptions.values()) {
      if (
        subscription.connectorId !== connectorId ||
        subscription.session.sessionId !== sessionId
      ) {
        continue;
      }
      subscription.session = {
        ...subscription.session,
        ...providerSession,
      };
    }
  }

  register(
    connectorId: string,
    activeSessionIds: string[],
    send: (command: HostConnectorCommand) => void,
    connectorCapabilities: readonly HostConnectorCapability[] = [],
  ): () => void {
    this.clearDisconnectTimer(connectorId);
    const supported = new Set<string>(HOST_CONNECTOR_CAPABILITIES);
    const capabilities = new Set(
      connectorCapabilities.filter((capability) => supported.has(capability)),
    );
    const sessionIds = new Set(activeSessionIds);
    for (const id of sessionIds) this.idleNotifications.reset(id);
    const channel = { send, capabilities, sessionIds };
    this.channels.set(connectorId, channel);
    for (const sessionId of sessionIds) {
      const current = this.sessionDirectory.get(sessionId);
      if (!current || current.connectorId !== connectorId) {
        this.sessionDirectory.set(sessionId, {
          connectorId,
          session: { sessionId, runtimeStatus: "idle" },
        });
      }
    }
    send({
      type: "sync",
      connectionEpoch: crypto.randomUUID(),
      activeSessionIds,
      serverInfo: {
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        capabilities: [...capabilities],
      },
    });
    this.reconcilePendingRequests(connectorId, channel);
    void this.resubscribe(connectorId, channel);
    // Each registration starts a new connection epoch, which drops the
    // connector's previous watches; re-establish the ones still listened to.
    for (const watch of this.gitWatches.values()) {
      if (watch.connectorId !== connectorId) continue;
      this.setGitWatchLive(watch, false);
      this.startGitWatch(watch);
    }
    return () => {
      if (this.channels.get(connectorId) !== channel) return;
      this.channels.delete(connectorId);
      for (const id of channel.sessionIds) this.idleNotifications.reset(id);
      for (const watch of this.gitWatches.values()) {
        if (watch.connectorId !== connectorId) continue;
        watch.generation += 1;
        this.setGitWatchLive(watch, false);
      }
      this.scheduleDisconnect(connectorId);
    };
  }

  request<T = unknown>(
    connectorId: string,
    request: AgentDaemonRequest,
  ): Promise<T> {
    const channel = this.channels.get(connectorId);
    if (!channel) {
      return Promise.reject(
        new Error("The OvertChat Host Connector is offline."),
      );
    }
    const requestId = crypto.randomUUID();
    const sessionId = sessionIdForRequest(request);
    if (sessionId) channel.sessionIds.add(sessionId);
    if (
      request.type === "session_command" &&
      request.command.type === "abort"
    ) {
      this.idleNotifications.suppress(request.session.sessionId);
    }
    if (request.type === "stop_session")
      this.idleNotifications.suppress(request.sessionId);

    const replaySafe =
      isLedgerProtectedCommand(request) &&
      channel.capabilities.has("command-wal-v1");
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            replaySafe
              ? "Timed out waiting for the Host Connector. The command outcome is unknown; inspect the session before retrying."
              : "Timed out waiting for the Host Connector.",
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      timeout.unref();
      this.pending.set(requestId, {
        connectorId,
        request,
        replaySafe,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        channel.send({ type: "request", requestId, request });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private reconcilePendingRequests(
    connectorId: string,
    channel: Channel,
  ): void {
    const replaced = new Error(
      "The OvertChat Host Connector reconnected before the request completed.",
    );
    const commandOutcomeUnknown = new Error(
      "The command outcome is unknown because the Host Connector reconnected before responding. Inspect the session before retrying.",
    );
    for (const [requestId, pending] of this.pending) {
      if (pending.connectorId !== connectorId) continue;
      if (
        pending.request.type !== "session_command" ||
        !pending.replaySafe ||
        !channel.capabilities.has("command-wal-v1")
      ) {
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.reject(
          isLedgerProtectedCommand(pending.request)
            ? commandOutcomeUnknown
            : replaced,
        );
        continue;
      }
      try {
        channel.send({
          type: "request",
          requestId,
          request: pending.request,
        });
      } catch (error) {
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  async subscribeSession(
    connectorId: string,
    session: AgentDaemonSessionDescriptor,
    after: { epoch: string; sequence: number } | undefined,
    subscriber: (envelope: AgentRuntimeEnvelope) => void,
    synchronize: (sync: AgentSessionSync) => void,
    disconnect: (error: Error) => void,
  ): Promise<{
    unsubscribe: () => void;
    authoritative: boolean;
    sync?: AgentSessionSync;
  }> {
    const channel = this.channels.get(connectorId);
    if (!channel) {
      throw new Error("The OvertChat Host Connector is offline.");
    }
    const subscriptionId = crypto.randomUUID();
    const replayBuffer: AgentRuntimeEnvelope[] = [];
    const subscription: SessionSubscription = {
      connectorId,
      session,
      authoritative: channel.capabilities.has("session-sync-v1"),
      initialized: false,
      after,
      subscriber,
      synchronize,
      disconnect,
      replayBuffer,
    };
    this.subscriptions.set(subscriptionId, subscription);
    let sync: AgentSessionSync | undefined;
    try {
      const result = await this.request<{ sync?: unknown }>(connectorId, {
        type: "subscribe_session",
        subscriptionId,
        session,
        ...(after ? { after } : {}),
      });
      if (
        this.channels.get(connectorId) !== channel ||
        this.subscriptions.get(subscriptionId) !== subscription ||
        subscription.replayBuffer !== replayBuffer
      ) {
        throw new Error(
          "The Host Connector channel changed while subscribing.",
        );
      }
      sync = this.readSessionSync(connectorId, session, after, result?.sync);
      if (sync) subscription.after = sync.cursor;
      subscription.initialized = true;
    } catch (error) {
      if (this.subscriptions.get(subscriptionId) === subscription) {
        this.subscriptions.delete(subscriptionId);
        this.sendUnsubscribe(connectorId, subscriptionId);
      }
      throw error;
    }
    const buffered = replayBuffer;
    subscription.replayBuffer = null;
    for (const envelope of buffered) {
      this.deliverEnvelope(subscription, envelope);
    }
    const unsubscribe = () => {
      if (!this.subscriptions.delete(subscriptionId)) return;
      this.sendUnsubscribe(connectorId, subscriptionId);
    };
    return {
      unsubscribe,
      authoritative: subscription.authoritative,
      ...(sync ? { sync } : {}),
    };
  }

  async acceptBatch(
    connectorId: string,
    connectorEpoch: string,
    events: readonly HostConnectorEvent[],
  ): Promise<HostConnectorEventAck> {
    if (events.length === 0) {
      throw new Error("The Host Connector sent an empty event batch.");
    }
    for (let index = 1; index < events.length; index += 1) {
      if (events[index]!.sequence !== events[index - 1]!.sequence + 1) {
        throw new Error("The Host Connector event batch is not contiguous.");
      }
    }
    for (const event of events) {
      let cursors = this.notificationSequences.get(connectorId);
      if (!cursors) {
        cursors = new Map();
        this.notificationSequences.set(connectorId, cursors);
      }
      const sequence = cursors.get(connectorEpoch);
      const fresh = sequence === undefined || event.sequence > sequence;
      // Claim the notification cursor before yielding: overlapping retry
      // batches must not replay status transitions while metadata is awaited.
      if (fresh) {
        cursors.set(connectorEpoch, event.sequence);
        // Durable and live traffic have independent epochs and now alternate.
        // Retain both deduplication cursors while bounding retired identities.
        if (cursors.size > 8) cursors.delete(cursors.keys().next().value!);
      }
      await this.accept(connectorId, event.payload, fresh);
    }
    return {
      connectorEpoch,
      acknowledgedSequence: events.at(-1)!.sequence,
    };
  }

  async listSshHosts(connectorId: string): Promise<ConnectorSshHost[]> {
    const value = await this.request(connectorId, { type: "list_ssh_hosts" });
    if (!Array.isArray(value) || !value.every(isConnectorSshHost)) {
      throw new Error("The Host Connector returned an invalid SSH host list.");
    }
    return value;
  }

  private async accept(
    connectorId: string,
    event: HostConnectorEventPayload,
    freshNotification = true,
  ): Promise<void> {
    if (event.type === "response") {
      const pending = this.pending.get(event.requestId);
      if (!pending || pending.connectorId !== connectorId) return;
      clearTimeout(pending.timeout);
      this.pending.delete(event.requestId);
      if (event.success) pending.resolve(event.data);
      else pending.reject(new Error(event.error));
      return;
    }
    if (event.type === "session_directory") {
      this.acceptSessionDirectory(
        connectorId,
        event.sessions,
        freshNotification,
      );
      return;
    }
    if (event.type === "session_update") {
      const channel = this.channels.get(connectorId);
      if (
        freshNotification &&
        channel?.sessionIds.has(event.session.sessionId)
      ) {
        this.idleNotifications.update(
          event.session.sessionId,
          event.session.runtimeStatus,
        );
      }
      this.acceptSessionDirectory(connectorId, [event.session], false);
      return;
    }
    if (event.type === "workspace_git_status") {
      const watch = this.gitWatchIds.get(event.watchId);
      if (
        !watch ||
        watch.connectorId !== connectorId ||
        event.revision <= watch.revision
      ) {
        return;
      }
      // A push may overtake the watch response; it is kept and wins if newer.
      watch.status = event.status;
      watch.revision = event.revision;
      if (watch.live) {
        this.notifyGitWatch(watch, { type: "status", status: event.status });
      }
      return;
    }
    if (event.type === "session_metadata") {
      const { providerModifiedAt, ...metadata } = event.patch;
      await updateAgentSessionMetadata(event.sessionId, {
        ...metadata,
        ...(providerModifiedAt !== undefined
          ? { providerModifiedAt: new Date(providerModifiedAt) }
          : {}),
      });
      return;
    }
    const subscription = this.subscriptions.get(event.subscriptionId);
    if (
      !subscription ||
      subscription.connectorId !== connectorId ||
      subscription.session.sessionId !== event.sessionId
    ) {
      return;
    }
    if (subscription.replayBuffer) {
      subscription.replayBuffer.push(event.envelope);
      return;
    }
    this.deliverEnvelope(subscription, event.envelope);
  }

  private async resubscribe(
    connectorId: string,
    channel: Channel,
  ): Promise<void> {
    const matching = [...this.subscriptions.entries()].filter(
      ([, subscription]) => subscription.connectorId === connectorId,
    );
    await Promise.all(
      matching.map(async ([subscriptionId, subscription]) => {
        if (this.channels.get(connectorId) !== channel) return;
        if (!subscription.initialized) return;
        const authoritative = channel.capabilities.has("session-sync-v1");
        if (authoritative !== subscription.authoritative) {
          if (this.subscriptions.get(subscriptionId) !== subscription) return;
          this.subscriptions.delete(subscriptionId);
          this.sendUnsubscribe(connectorId, subscriptionId);
          subscription.disconnect(
            new Error("The Host Connector streaming mode changed."),
          );
          return;
        }
        const after = subscription.after;
        const replayBuffer: AgentRuntimeEnvelope[] = [];
        subscription.replayBuffer = replayBuffer;
        try {
          const result = await this.request<{ sync?: unknown }>(connectorId, {
            type: "subscribe_session",
            subscriptionId,
            session: subscription.session,
            ...(after ? { after } : {}),
          });
          if (
            this.channels.get(connectorId) !== channel ||
            this.subscriptions.get(subscriptionId) !== subscription ||
            subscription.replayBuffer !== replayBuffer
          ) {
            return;
          }
          const sync = this.readSessionSync(
            connectorId,
            subscription.session,
            after,
            result?.sync,
          );
          if (sync) {
            subscription.after = sync.cursor;
            subscription.synchronize(sync);
          }
          subscription.replayBuffer = null;
          for (const envelope of replayBuffer) {
            this.deliverEnvelope(subscription, envelope);
          }
        } catch (error) {
          if (
            this.channels.get(connectorId) !== channel ||
            this.subscriptions.get(subscriptionId) !== subscription ||
            subscription.replayBuffer !== replayBuffer
          ) {
            return;
          }
          subscription.replayBuffer = null;
          this.subscriptions.delete(subscriptionId);
          this.sendUnsubscribe(connectorId, subscriptionId);
          subscription.disconnect(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }),
    );
  }

  private deliverEnvelope(
    subscription: SessionSubscription,
    envelope: AgentRuntimeEnvelope,
  ): void {
    const cursor = subscription.after;
    if (
      cursor?.epoch === envelope.epoch &&
      envelope.sequence <= cursor.sequence
    ) {
      return;
    }
    const legacyForward =
      !subscription.authoritative &&
      (envelope.type === "snapshot" ||
        !cursor ||
        (cursor.epoch === envelope.epoch &&
          envelope.sequence > cursor.sequence));
    if (
      legacyForward ||
      !cursor ||
      (cursor.epoch === envelope.epoch &&
        envelope.sequence === cursor.sequence + 1)
    ) {
      subscription.after = {
        epoch: envelope.epoch,
        sequence: envelope.sequence,
      };
    }
    subscription.subscriber(envelope);
  }

  private acceptSessionDirectory(
    connectorId: string,
    sessions: readonly AgentSessionDirectoryEntry[],
    baseline = true,
  ): void {
    const channel = this.channels.get(connectorId);
    if (!channel) return;
    for (const session of sessions) {
      if (!channel.sessionIds.has(session.sessionId)) continue;
      if (baseline)
        this.idleNotifications.reset(session.sessionId, session.runtimeStatus);
      if (session.lastTurn) {
        try {
          recordAgentSessionLastTurn(session.sessionId, session.lastTurn);
        } catch {
          console.error("[agents] Could not record the latest turn.");
        }
      }
      this.upsertSessionDirectory(connectorId, session);
    }
  }

  private upsertSessionDirectory(
    connectorId: string,
    session: AgentSessionDirectoryEntry,
  ): void {
    const current = this.sessionDirectory.get(session.sessionId);
    if (
      current?.connectorId === connectorId &&
      sameAgentSessionDirectoryEntry(current.session, session)
    ) {
      return;
    }
    this.sessionDirectory.set(session.sessionId, { connectorId, session });
    for (const subscription of this.directorySubscriptions) {
      if (subscription.sessionIds.has(session.sessionId)) {
        subscription.subscriber({ type: "update", session });
      }
    }
  }

  private sendUnsubscribe(connectorId: string, subscriptionId: string): void {
    const channel = this.channels.get(connectorId);
    if (!channel) return;
    try {
      channel.send({
        type: "request",
        requestId: crypto.randomUUID(),
        request: { type: "unsubscribe_session", subscriptionId },
      });
    } catch {
      // The connector may have gone offline before the lease could be released.
    }
  }

  private readSessionSync(
    connectorId: string,
    session: AgentDaemonSessionDescriptor,
    after: { epoch: string; sequence: number } | undefined,
    value: unknown,
  ): AgentSessionSync | undefined {
    if (value === undefined) {
      if (this.channels.get(connectorId)?.capabilities.has("session-sync-v1")) {
        throw new Error(
          "The Host Connector omitted the authoritative session sync.",
        );
      }
      return undefined;
    }
    if (!isAgentSessionSync(value)) {
      throw new Error("The Host Connector returned an invalid session sync.");
    }
    if (
      (value.reset && value.snapshot.sessionId !== session.sessionId) ||
      (!value.reset &&
        value.events.some(
          (event) =>
            event.type === "snapshot" &&
            event.data.sessionId !== session.sessionId,
        ))
    ) {
      throw new Error("The Host Connector synchronized a different session.");
    }
    if (
      !value.reset &&
      (!after ||
        value.cursor.epoch !== after.epoch ||
        (value.events[0]?.sequence ?? value.cursor.sequence + 1) !==
          after.sequence + 1)
    ) {
      throw new Error(
        "The Host Connector returned a non-contiguous session sync.",
      );
    }
    return value;
  }

  private clearDisconnectTimer(connectorId: string): void {
    const timer = this.disconnectTimers.get(connectorId);
    if (!timer) return;
    clearTimeout(timer);
    this.disconnectTimers.delete(connectorId);
  }

  private scheduleDisconnect(connectorId: string): void {
    this.clearDisconnectTimer(connectorId);
    const timer = setTimeout(() => {
      if (
        this.disconnectTimers.get(connectorId) !== timer ||
        this.channels.has(connectorId)
      ) {
        return;
      }
      this.disconnectTimers.delete(connectorId);
      const error = new Error("The OvertChat Host Connector is offline.");
      for (const [requestId, request] of this.pending) {
        if (request.connectorId !== connectorId) continue;
        if (isLedgerProtectedCommand(request.request) && request.replaySafe) {
          continue;
        }
        clearTimeout(request.timeout);
        this.pending.delete(requestId);
        request.reject(error);
      }
      for (const [subscriptionId, subscription] of this.subscriptions) {
        if (subscription.connectorId !== connectorId) continue;
        this.subscriptions.delete(subscriptionId);
        subscription.disconnect(error);
      }
      for (const entry of this.sessionDirectory.values()) {
        if (entry.connectorId !== connectorId) continue;
        this.upsertSessionDirectory(connectorId, {
          ...entry.session,
          runtimeStatus: "exited",
          turnStartedAt: null,
          attention: null,
        });
      }
    }, this.disconnectGraceMs);
    timer.unref();
    this.disconnectTimers.set(connectorId, timer);
  }
}

const globalForHostConnector = globalThis as typeof globalThis & {
  overtchatHostConnectorBroker?: HostConnectorBroker;
};

export const hostConnectorBroker =
  globalForHostConnector.overtchatHostConnectorBroker ??
  new HostConnectorBroker();

globalForHostConnector.overtchatHostConnectorBroker = hostConnectorBroker;
