import {
  AGENT_PRESENCE_WINDOW_MS,
  type AgentNotification,
} from "./agentNotification";

export { AGENT_PRESENCE_WINDOW_MS };

export type AgentClientPresence = {
  clientId: string;
  /** The last heartbeat, on the server's clock. */
  at: number;
  visible: boolean;
  /** The agent session open in the client, if any. */
  viewing: string | null;
  /** Whether the client is connected and its device wants alerts. */
  notify: boolean;
};

export type AgentNotificationPlan = {
  /** The one client to tell, or none. */
  recipient: string | null;
  /** Whether phones get a push instead. */
  push: boolean;
};

/**
 * Nobody is told while a present client is looking at the session. Otherwise
 * the client used most recently is told, and phones only when no present
 * client wants alerts.
 */
export function planAgentNotification(
  clients: readonly AgentClientPresence[],
  sessionId: string,
  now: number,
): AgentNotificationPlan {
  let recipient: AgentClientPresence | null = null;
  for (const client of clients) {
    if (now - client.at > AGENT_PRESENCE_WINDOW_MS) continue;
    if (client.visible && client.viewing === sessionId) {
      return { recipient: null, push: false };
    }
    if (client.notify && (!recipient || client.at > recipient.at)) {
      recipient = client;
    }
  }
  return { recipient: recipient?.clientId ?? null, push: !recipient };
}

type Sink = (notification: AgentNotification) => void;
type ClientRecord = Omit<AgentClientPresence, "notify"> & {
  wantsAlerts: boolean;
  /** The client's open event streams, oldest first; the newest is told. */
  sinks: Sink[];
};

/** Each owner's web and desktop clients: their heartbeats and event streams. */
export class AgentClientRegistry {
  private readonly users = new Map<string, Map<string, ClientRecord>>();

  record(
    userId: string,
    presence: { clientId: string; visible: boolean; viewing: string | null; notify: boolean },
    now = Date.now(),
  ): void {
    const clients = this.clientsOf(userId);
    const record = clients.get(presence.clientId);
    if (record) {
      record.at = now;
      record.visible = presence.visible;
      record.viewing = presence.viewing;
      record.wantsAlerts = presence.notify;
    } else {
      clients.set(presence.clientId, {
        clientId: presence.clientId,
        at: now,
        visible: presence.visible,
        viewing: presence.viewing,
        wantsAlerts: presence.notify,
        sinks: [],
      });
    }
    this.prune(userId, now);
  }

  /**
   * Attaches one of the client's event streams. A page can hold more than one
   * (a phone's drawer runs a second sidebar), so the client stays attached
   * until its last stream closes, and is told through the newest.
   */
  subscribe(userId: string, clientId: string, sink: Sink, now = Date.now()): () => void {
    const clients = this.clientsOf(userId);
    let record = clients.get(clientId);
    if (!record) {
      record = { clientId, at: now, visible: false, viewing: null, wantsAlerts: false, sinks: [] };
      clients.set(clientId, record);
    }
    record.sinks.push(sink);
    return () => {
      record.sinks = record.sinks.filter((item) => item !== sink);
      if (record.sinks.length > 0) return;
      // Without a stream the client cannot be looking at anything.
      record.visible = false;
      record.viewing = null;
    };
  }

  clients(userId: string, now = Date.now()): AgentClientPresence[] {
    const result: AgentClientPresence[] = [];
    for (const record of this.users.get(userId)?.values() ?? []) {
      if (now - record.at > AGENT_PRESENCE_WINDOW_MS) continue;
      result.push({
        clientId: record.clientId,
        at: record.at,
        visible: record.visible,
        viewing: record.viewing,
        notify: record.wantsAlerts && record.sinks.length > 0,
      });
    }
    return result;
  }

  deliver(userId: string, clientId: string, notification: AgentNotification): boolean {
    const sink = this.users.get(userId)?.get(clientId)?.sinks.at(-1);
    if (!sink) return false;
    sink(notification);
    return true;
  }

  private clientsOf(userId: string): Map<string, ClientRecord> {
    let clients = this.users.get(userId);
    if (!clients) {
      clients = new Map();
      this.users.set(userId, clients);
    }
    return clients;
  }

  private prune(userId: string, now: number): void {
    const clients = this.users.get(userId);
    if (!clients) return;
    for (const [clientId, record] of clients) {
      if (record.sinks.length === 0 && now - record.at > AGENT_PRESENCE_WINDOW_MS) {
        clients.delete(clientId);
      }
    }
    if (clients.size === 0) this.users.delete(userId);
  }
}

const globalForPresence = globalThis as typeof globalThis & {
  overtchatAgentClientRegistry?: AgentClientRegistry;
};

export const agentClientRegistry =
  globalForPresence.overtchatAgentClientRegistry ?? new AgentClientRegistry();

globalForPresence.overtchatAgentClientRegistry = agentClientRegistry;
