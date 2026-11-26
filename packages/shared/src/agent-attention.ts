import { i18n } from "./i18n/i18n";
import type {
  AgentConnectionListItem,
  AgentProviderId,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";

/**
 * What a session asks of its owner, most urgent first: a pending approval or
 * question, a failed turn not yet seen, active work, then a finished turn not
 * yet seen. Every client derives it the same way from the session list.
 */
export type AgentSessionState =
  | "approval"
  | "question"
  | "failed"
  | "working"
  | "unread"
  | "idle";

type AttentionFields = Pick<
  AgentSessionListItem,
  "runtimeStatus" | "attention" | "lastTurn" | "readTurnEndedAt"
>;

/** Whether the latest turn ended after the owner last saw the session. */
export function agentSessionHasUnseenTurn(session: AttentionFields): boolean {
  const turn = session.lastTurn;
  // Stopping is the owner's own action, so there is nothing new to see.
  if (!turn || turn.outcome === "stopped") return false;
  return turn.endedAt > (session.readTurnEndedAt ?? -Infinity);
}

export function agentSessionState(session: AttentionFields): AgentSessionState {
  if (session.attention) return session.attention.kind;
  const unseen = agentSessionHasUnseenTurn(session);
  if (unseen && session.lastTurn?.outcome === "failed") return "failed";
  if (session.runtimeStatus === "running") return "working";
  return unseen ? "unread" : "idle";
}

/** States the Agents toggle counts as needing their owner. */
export function agentSessionNeedsOwner(state: AgentSessionState): boolean {
  return state === "approval" || state === "question" || state === "failed";
}

/** How a state is announced; idle says nothing. */
const SESSION_STATE_KEYS = {
  approval: "agents.sessionState.approval",
  question: "agents.sessionState.question",
  failed: "agents.sessionState.failed",
  working: "agents.sessionState.working",
  unread: "agents.sessionState.unread",
} as const;

export function agentSessionStateLabel(state: AgentSessionState): string {
  return state === "idle" ? "" : i18n.t(SESSION_STATE_KEYS[state]);
}

/** The most recent time anything happened in the session. */
export function agentSessionActivityAt(session: AgentSessionListItem): number {
  return Math.max(
    session.modifiedAt ?? 0,
    session.createdAt ?? 0,
    session.lastTurn?.endedAt ?? 0,
    session.turnStartedAt ?? 0,
    session.attention?.requestedAt ?? 0,
  );
}

/** When a session entered its current state. */
export function agentSessionStateSince(
  session: AgentSessionListItem,
  state: AgentSessionState,
): number {
  if (session.attention) return session.attention.requestedAt;
  if (state === "working") return session.turnStartedAt ?? 0;
  if (state === "idle") return agentSessionActivityAt(session);
  return session.lastTurn?.endedAt ?? 0;
}

/** A session as a client lists it under its folder. */
export type AgentAttentionSession = {
  provider: AgentProviderId;
  workspaceId: string;
  session: AgentSessionListItem;
};

/** A folder with its sessions; clients add their own fields. */
export type AgentAttentionGroup = {
  sessions: readonly AgentAttentionSession[];
};

export type AgentAttentionEntry<G extends AgentAttentionGroup> = {
  item: G["sessions"][number];
  group: G;
  state: AgentSessionState;
  /** When the session entered its current state. */
  since: number;
};

/** The status groups, in the order lists show them. */
export type AgentAttentionSectionsOf<G extends AgentAttentionGroup> = {
  /** Waiting on an approval or an answer. */
  needsInput: AgentAttentionEntry<G>[];
  /** The last turn failed and has not been seen. */
  failed: AgentAttentionEntry<G>[];
  /** The last turn finished and has not been seen. */
  ready: AgentAttentionEntry<G>[];
  working: AgentAttentionEntry<G>[];
  /** Everything else, most recently active first. */
  done: AgentAttentionEntry<G>[];
};

export type AgentAttentionSectionKey = keyof AgentAttentionSectionsOf<AgentAttentionGroup>;

/** Each status group and the state its rows wear. */
export const AGENT_ATTENTION_SECTIONS: readonly {
  key: AgentAttentionSectionKey;
  state: AgentSessionState;
}[] = [
  { key: "needsInput", state: "approval" },
  { key: "failed", state: "failed" },
  { key: "ready", state: "unread" },
  { key: "working", state: "working" },
  { key: "done", state: "idle" },
];

const SECTION_LABEL_KEYS = {
  needsInput: "sidebar.agents.statusGroups.needsInput",
  failed: "sidebar.agents.statusGroups.failed",
  ready: "sidebar.agents.statusGroups.ready",
  working: "sidebar.agents.statusGroups.working",
  done: "sidebar.agents.statusGroups.done",
} as const;

export function agentAttentionSectionLabel(
  key: AgentAttentionSectionKey,
): string {
  return i18n.t(SECTION_LABEL_KEYS[key]);
}

/** Every session filed by what it needs from its owner, newest first. */
export function agentAttentionSections<G extends AgentAttentionGroup>(
  groups: readonly G[],
  providerFilter: AgentProviderId | null = null,
): AgentAttentionSectionsOf<G> {
  const sections: AgentAttentionSectionsOf<G> = {
    needsInput: [],
    failed: [],
    ready: [],
    working: [],
    done: [],
  };
  for (const group of groups) {
    for (const item of group.sessions) {
      if (providerFilter && item.provider !== providerFilter) continue;
      const state = agentSessionState(item.session);
      const entry: AgentAttentionEntry<G> = {
        item,
        group,
        state,
        since: agentSessionStateSince(item.session, state),
      };
      if (state === "approval" || state === "question") sections.needsInput.push(entry);
      else if (state === "failed") sections.failed.push(entry);
      else if (state === "unread") sections.ready.push(entry);
      else if (state === "working") sections.working.push(entry);
      else sections.done.push(entry);
    }
  }
  for (const list of Object.values(sections)) {
    list.sort((left, right) => right.since - left.since);
  }
  return sections;
}

export type AgentAttentionCounts = { needsYou: number; unread: number };

/** Totals for the Agents mode toggle. */
export function agentAttentionCounts(
  connections: readonly AgentConnectionListItem[],
): AgentAttentionCounts {
  const counts = { needsYou: 0, unread: 0 };
  for (const connection of connections) {
    for (const workspace of connection.workspaces) {
      for (const session of workspace.sessions) {
        const state = agentSessionState(session);
        if (agentSessionNeedsOwner(state)) counts.needsYou += 1;
        else if (state === "unread") counts.unread += 1;
      }
    }
  }
  return counts;
}

const STATE_PRIORITY: readonly AgentSessionState[] = [
  "approval",
  "question",
  "failed",
  "working",
  "unread",
  "idle",
];

/** The most urgent state among sessions, as a collapsed workspace shows it. */
export function mostUrgentAgentSessionState(
  sessions: readonly AttentionFields[],
): AgentSessionState {
  let best = STATE_PRIORITY.length - 1;
  for (const session of sessions) {
    best = Math.min(best, STATE_PRIORITY.indexOf(agentSessionState(session)));
  }
  return STATE_PRIORITY[best]!;
}

/** Whether a session has a finished turn its owner can mark read or unread. */
export function agentSessionCanToggleRead(
  session: Pick<AgentSessionListItem, "lastTurn">,
  state: AgentSessionState,
): boolean {
  return (
    session.lastTurn != null &&
    state !== "working" &&
    state !== "approval" &&
    state !== "question"
  );
}

/** A compact running time such as "45s", "12m" or "1h 5m". */
export function formatAgentWorkingTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) {
    return i18n.t("agents.activity.elapsedSeconds", { seconds });
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return i18n.t("agents.activity.elapsedMinutes", { minutes });
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? i18n.t("agents.activity.elapsedHoursMinutes", { hours, minutes: remainder })
    : i18n.t("agents.activity.elapsedHours", { hours });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A compact age for list rows, such as "now", "5m", "3h", "2d" or "Oct 4". */
export function formatAgentSessionAge(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) return i18n.t("agents.age.now");
  if (elapsed < HOUR_MS) {
    return i18n.t("agents.age.minutes", { count: Math.floor(elapsed / MINUTE_MS) });
  }
  if (elapsed < DAY_MS) {
    return i18n.t("agents.age.hours", { count: Math.floor(elapsed / HOUR_MS) });
  }
  if (elapsed < 7 * DAY_MS) {
    return i18n.t("agents.age.days", { count: Math.floor(elapsed / DAY_MS) });
  }
  if (elapsed < 5 * 7 * DAY_MS) {
    return i18n.t("agents.age.weeks", { count: Math.floor(elapsed / (7 * DAY_MS)) });
  }
  const sameYear =
    new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The saved name, else the first message; null when the session has neither. */
export function agentSessionDisplayTitle(
  session: Pick<AgentSessionListItem, "name" | "firstMessage">,
): string | null {
  return session.name || session.firstMessage || null;
}

/**
 * Moves a session's read watermark to its latest turn, or just before it so
 * that turn reads as unseen. Sessions without a finished turn are unchanged,
 * and so is the list when nothing moved.
 */
export function withAgentSessionReadState(
  connections: AgentConnectionListItem[],
  sessionId: string,
  read: boolean,
): AgentConnectionListItem[] {
  let changed = false;
  const next = connections.map((connection) => {
    let connectionChanged = false;
    const workspaces = connection.workspaces.map((workspace) => {
      let workspaceChanged = false;
      const sessions = workspace.sessions.map((session) => {
        if (session.id !== sessionId || !session.lastTurn) return session;
        const { endedAt } = session.lastTurn;
        const readTurnEndedAt = read
          ? Math.max(session.readTurnEndedAt ?? -Infinity, endedAt)
          : endedAt - 1;
        if (readTurnEndedAt === session.readTurnEndedAt) return session;
        changed = connectionChanged = workspaceChanged = true;
        return { ...session, readTurnEndedAt };
      });
      return workspaceChanged ? { ...workspace, sessions } : workspace;
    });
    return connectionChanged ? { ...connection, workspaces } : connection;
  });
  return changed ? next : connections;
}
