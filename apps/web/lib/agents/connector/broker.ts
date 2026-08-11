import "server-only";
import {
  isConnectorSshHost,
  type AgentDaemonRequest,
  type AgentDaemonSessionDescriptor,
  type AgentRuntimeEnvelope,
  type AgentRuntimeStatus,
  type ConnectorSshHost,
  type HostConnectorCommand,
  type HostConnectorEvent,
  type HostConnectorEventAck,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import { updateAgentSessionMetadata } from "@/lib/db/agentConnections";

const REQUEST_TIMEOUT_MS = 180_000;
const CONNECTOR_DISCONNECT_GRACE_MS = 5_000;

type Channel = { send: (command: HostConnectorCommand) => void };

type PendingRequest = {
  connectorId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type SessionSubscription = {
  connectorId: string;
  session: AgentDaemonSessionDescriptor;
  after?: { epoch: string; sequence: number };
  subscriber: (envelope: AgentRuntimeEnvelope) => void;
  disconnect: (error: Error) => void;
};

export class HostConnectorBroker {
  private readonly channels = new Map<string, Channel>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, SessionSubscription>();
  private readonly cursors = new Map<string, number>();
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

  register(
    connectorId: string,
    activeSessionIds: string[],
    send: (command: HostConnectorCommand) => void,
  ): () => void {
    this.clearDisconnectTimer(connectorId);
    const channel = { send };
    this.channels.set(connectorId, channel);
    send({
      type: "sync",
      connectionEpoch: crypto.randomUUID(),
      activeSessionIds,
    });
    void this.resubscribe(connectorId);
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
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Timed out waiting for the Host Connector."));
      }, REQUEST_TIMEOUT_MS);
      timeout.unref();
      this.pending.set(requestId, {
        connectorId,
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

  async subscribeSession(
    connectorId: string,
    session: AgentDaemonSessionDescriptor,
    after: { epoch: string; sequence: number } | undefined,
    subscriber: (envelope: AgentRuntimeEnvelope) => void,
    disconnect: (error: Error) => void,
  ): Promise<() => void> {
    const subscriptionId = crypto.randomUUID();
    this.subscriptions.set(subscriptionId, {
      connectorId,
      session,
      after,
      subscriber,
      disconnect,
    });
    try {
      await this.request(connectorId, {
        type: "subscribe_session",
        subscriptionId,
        session,
        ...(after ? { after } : {}),
      });
    } catch (error) {
      this.subscriptions.delete(subscriptionId);
      throw error;
    }
    return () => {
      if (!this.subscriptions.delete(subscriptionId)) return;
      void this.request(connectorId, {
        type: "unsubscribe_session",
        subscriptionId,
      }).catch(() => {});
    };
  }

  acceptBatch(
    connectorId: string,
    connectorEpoch: string,
    events: readonly HostConnectorEvent[],
  ): HostConnectorEventAck {
    const cursorKey = `${connectorId}:${connectorEpoch}`;
    let acknowledgedSequence = this.cursors.get(cursorKey) ?? 0;
    for (const event of events) {
      if (event.sequence <= acknowledgedSequence) continue;
      if (event.sequence !== acknowledgedSequence + 1) break;
      this.accept(connectorId, event.payload);
      acknowledgedSequence = event.sequence;
    }
    this.cursors.set(cursorKey, acknowledgedSequence);
    return {
      connectorEpoch,
      acknowledgedSequence,
    };
  }

  async listSshHosts(connectorId: string): Promise<ConnectorSshHost[]> {
    const value = await this.request(connectorId, { type: "list_ssh_hosts" });
    if (!Array.isArray(value) || !value.every(isConnectorSshHost)) {
      throw new Error("The Host Connector returned an invalid SSH host list.");
    }
    return value;
  }

  private accept(connectorId: string, event: HostConnectorEventPayload): void {
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
      void updateAgentSessionMetadata(event.sessionId, {
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
    const cursor = subscription.after;
    if (
      cursor?.epoch === event.envelope.epoch &&
      event.envelope.sequence <= cursor.sequence
    ) {
      return;
    }
    subscription.after = {
      epoch: event.envelope.epoch,
      sequence: event.envelope.sequence,
    };
    if (event.envelope.type === "snapshot") {
      this.sessionStatuses.set(event.sessionId, event.envelope.data.status);
    } else if (
      event.envelope.data.type === "overtchat_status" &&
      ["idle", "running", "exited"].includes(
        String(event.envelope.data.status),
      )
    ) {
      this.sessionStatuses.set(
        event.sessionId,
        event.envelope.data.status as AgentRuntimeStatus,
      );
    }
    subscription.subscriber(event.envelope);
  }

  private async resubscribe(connectorId: string): Promise<void> {
    const matching = [...this.subscriptions.entries()].filter(
      ([, subscription]) => subscription.connectorId === connectorId,
    );
    await Promise.allSettled(
      matching.map(([subscriptionId, subscription]) =>
        this.request(connectorId, {
          type: "subscribe_session",
          subscriptionId,
          session: subscription.session,
          ...(subscription.after ? { after: subscription.after } : {}),
        }),
      ),
    );
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
