import {
  AGENT_PRESENCE_LIVE_MS,
  AGENT_PRESENCE_WINDOW_MS,
  chatPresenceKey,
  type AgentNotification,
} from "./agentNotification";

export { AGENT_PRESENCE_LIVE_MS, AGENT_PRESENCE_WINDOW_MS, chatPresenceKey };

export type AgentClientPresence = {
  clientId: string;
  /** When the client was last used, on the server's clock. */
  activeAt: number;
  /** When the client last reported in, on the server's clock. */
  heardAt: number;
  visible: boolean;
  /** What is open in the client: an agent session's id, or a chat as {@link chatPresenceKey}. */
  viewing: string | null;
  /** Whether the device wants alerts. */
  alerts: boolean;
  /** Whether the server can send it one: it wants alerts and its stream is attached. */
  notify: boolean;
};

export type AgentNotificationPlan = {
  /** The clients to tell, if any. */
  recipients: string[];
  /** Whether phones get a push as well. */
  push: boolean;
};

/**
 * A client is present while it was used within the presence window. Nobody
 * is told while a present client is looking at the session. Otherwise the
 * present client used most recently is told and phones stay quiet. With no
 * such client, every connected client that wants alerts is told, since a tab
 * in the background is still the way to reach that computer, and phones are
 * told too.
 */
export function planAgentNotification(
  clients: readonly AgentClientPresence[],
  sessionId: string,
  now: number,
): AgentNotificationPlan {
  let recipient: AgentClientPresence | null = null;
  const connected: string[] = [];
  for (const client of clients) {
    const present = now - client.activeAt <= AGENT_PRESENCE_WINDOW_MS;
    if (present && client.visible && client.viewing === sessionId) {
      return { recipients: [], push: false };
    }
    if (!client.notify) continue;
    connected.push(client.clientId);
    if (present && (!recipient || client.activeAt > recipient.activeAt)) {
      recipient = client;
    }
  }
  return recipient
    ? { recipients: [recipient.clientId], push: false }
    : { recipients: connected, push: true };
}

/**
 * Whether phones are told a chat's reply is ready. A client that has the chat
 * open hears the reply finish itself, so phones stay quiet while such a client
 * is in use and either shows the chat or alerts on its own. Nothing but its
 * reports says the client is still running, so one that has gone quiet (a
 * closed laptop, a page in the background for a while) does not count: a
 * second alert costs less than none.
 */
export function chatReplyNeedsPush(
  clients: readonly AgentClientPresence[],
  chatId: string,
  now: number,
): boolean {
  const key = chatPresenceKey(chatId);
  return !clients.some(
    (client) =>
      now - client.activeAt <= AGENT_PRESENCE_WINDOW_MS &&
      now - client.heardAt <= AGENT_PRESENCE_LIVE_MS &&
      client.viewing === key &&
      (client.visible || client.alerts),
  );
}

type Sink = (notification: AgentNotification) => void;
type ClientRecord = Omit<AgentClientPresence, "notify" | "alerts" | "heardAt"> & {
  /** The last heartbeat, on the server's clock. */
  at: number;
  wantsAlerts: boolean;
  /** The client's open event streams, oldest first; the newest is told. */
  sinks: Sink[];
};

/** Each user's web and desktop clients: their heartbeats and event streams. */
export class AgentClientRegistry {
  private readonly users = new Map<string, Map<string, ClientRecord>>();

  record(
    userId: string,
    presence: {
      clientId: string;
      visible: boolean;
      viewing: string | null;
      notify: boolean;
      /** How long ago the client was last used. Older clients do not say. */
      idleMs?: number;
    },
    now = Date.now(),
  ): void {
    const clients = this.clientsOf(userId);
    const record = clients.get(presence.clientId);
    // A client that does not say counts as used whenever it reports in.
    const activeAt = now - (presence.idleMs ?? 0);
    if (record) {
      record.at = now;
      record.activeAt = activeAt;
      record.visible = presence.visible;
      record.viewing = presence.viewing;
      record.wantsAlerts = presence.notify;
    } else {
      clients.set(presence.clientId, {
        clientId: presence.clientId,
        at: now,
        activeAt,
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
      // Attached but not heard from yet: not known to be in use.
      record = {
        clientId,
        at: now,
        activeAt: -Infinity,
        visible: false,
        viewing: null,
        wantsAlerts: false,
        sinks: [],
      };
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

  /** Every client still attached or heard from within the presence window. */
  clients(userId: string, now = Date.now()): AgentClientPresence[] {
    const result: AgentClientPresence[] = [];
    for (const record of this.users.get(userId)?.values() ?? []) {
      if (record.sinks.length === 0 && now - record.at > AGENT_PRESENCE_WINDOW_MS) {
        continue;
      }
      result.push({
        clientId: record.clientId,
        activeAt: record.activeAt,
        heardAt: record.at,
        visible: record.visible,
        viewing: record.viewing,
        alerts: record.wantsAlerts,
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
