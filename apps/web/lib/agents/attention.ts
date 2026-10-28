import type {
  AgentConnectionListItem,
  AgentProviderId,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import type {
  AgentWorkspaceGroup,
  AgentWorkspaceSession,
} from "@/lib/agents/workspaces";

/**
 * What a session asks of its owner, most urgent first: a pending approval or
 * question, a failed turn not yet seen, active work, then a finished turn not
 * yet seen.
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

export type AgentAttentionItem = {
  item: AgentWorkspaceSession;
  group: AgentWorkspaceGroup;
  state: AgentSessionState;
  /** When the session entered its current state. */
  since: number;
};

/** The status groups, in the order the sidebar lists them. */
export type AgentAttentionSections = {
  /** Waiting on an approval or an answer. */
  needsInput: AgentAttentionItem[];
  /** The last turn failed and has not been seen. */
  failed: AgentAttentionItem[];
  /** The last turn finished and has not been seen. */
  ready: AgentAttentionItem[];
  working: AgentAttentionItem[];
  /** Everything else, most recently active first. */
  done: AgentAttentionItem[];
};

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

/** Every session filed by what it needs from its owner, newest first. */
export function agentAttentionSections(
  groups: readonly AgentWorkspaceGroup[],
  providerFilter: AgentProviderId | null = null,
): AgentAttentionSections {
  const sections: AgentAttentionSections = {
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
      const entry = {
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

/** A compact running time such as "45s", "12m" or "1h 5m". */
export function formatAgentWorkingTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A compact age for list rows, such as "now", "5m", "3h", "2d" or "Oct 4". */
export function formatAgentSessionAge(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d`;
  if (elapsed < 5 * 7 * DAY_MS) return `${Math.floor(elapsed / (7 * DAY_MS))}w`;
  const sameYear =
    new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
