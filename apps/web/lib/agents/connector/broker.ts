import "server-only";
import {
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isAgentSessionSync,
  isConnectorSshHost,
  type AgentDaemonRequest,
  type AgentDaemonSessionDescriptor,
  type AgentRuntimeEnvelope,
  type AgentSessionSync,
  type AgentRuntimeStatus,
  type ConnectorSshHost,
  type HostConnectorCommand,
  type HostConnectorCapability,
  type HostConnectorEvent,
  type HostConnectorEventAck,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import { updateAgentSessionMetadata } from "@/lib/db/agentConnections";

const REQUEST_TIMEOUT_MS = 180_000;
const CONNECTOR_DISCONNECT_GRACE_MS = 5_000;

type Channel = {
  send: (command: HostConnectorCommand) => void;
  capabilities: Set<HostConnectorCapability>;
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
    request.type === "session_command" &&
    request.command.type !== "show_usage"
  );
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

export class HostConnectorBroker {
  private readonly channels = new Map<string, Channel>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, SessionSubscription>();
  private readonly sessionStatuses = new Map<string, AgentRuntimeStatus>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly disconnectGraceMs = CONNECTOR_DISCONNECT_GRACE_MS,
  ) {}

  isOnline(connectorId: string): boolean {
    return this.channels.has(connectorId);
  }

  runtimeStatusForSession(sessionId: string): AgentRuntimeStatus {
    return this.sessionStatuses.get(sessionId) ?? "idle";
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
    const channel = { send, capabilities };
    this.channels.set(connectorId, channel);
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
    return () => {
      if (this.channels.get(connectorId) !== channel) return;
      this.channels.delete(connectorId);
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
      if (sync) {
        subscription.after = sync.cursor;
        this.projectSessionSyncStatus(session.sessionId, sync);
      }
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
      await this.accept(connectorId, event.payload);
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
            this.projectSessionSyncStatus(subscription.session.sessionId, sync);
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
    this.projectEnvelopeStatus(subscription.session.sessionId, envelope);
    subscription.subscriber(envelope);
  }

  private projectSessionSyncStatus(
    sessionId: string,
    sync: AgentSessionSync,
  ): void {
    if (sync.reset) {
      this.sessionStatuses.set(sessionId, sync.snapshot.status);
      return;
    }
    for (const envelope of sync.events) {
      this.projectEnvelopeStatus(sessionId, envelope);
    }
  }

  private projectEnvelopeStatus(
    sessionId: string,
    envelope: AgentRuntimeEnvelope,
  ): void {
    if (envelope.type === "snapshot") {
      this.sessionStatuses.set(sessionId, envelope.data.status);
    } else if (
      envelope.data.type === "overtchat_status" &&
      ["idle", "running", "exited"].includes(String(envelope.data.status))
    ) {
      this.sessionStatuses.set(
        sessionId,
        envelope.data.status as AgentRuntimeStatus,
      );
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
      if (
        this.channels
          .get(connectorId)
          ?.capabilities.has("session-sync-v1")
      ) {
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
        if (
          isLedgerProtectedCommand(request.request) && request.replaySafe
        ) {
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
