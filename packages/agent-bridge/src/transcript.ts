import type { AgentRuntimeCursor, AgentRuntimeSnapshot } from "./agents";
import { agentForkMessageId } from "./history";

/** Paseo-style item windows: older transcript data is read separately from live sync. */
export const AGENT_HISTORY_PAGE_SIZE = 10;

function pageStart(messages: unknown[], end: number): number {
  let turns = 0;
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      message &&
      typeof message === "object" &&
      Reflect.get(message, "role") === "user" &&
      ++turns === AGENT_HISTORY_PAGE_SIZE
    ) {
      const turn = Reflect.get(message, "overtchatTurnId");
      let start = index;
      if (typeof turn === "string")
        while (
          start > 0 &&
          messages[start - 1] &&
          typeof messages[start - 1] === "object" &&
          Reflect.get(messages[start - 1] as object, "overtchatTurnId") === turn
        )
          start--;
      return start;
    }
  }
  return 0;
}
export type AgentHistoryPage = {
  sessionId: string;
  cursor: AgentRuntimeCursor;
  anchor: string;
  messages: unknown[];
  beforeCursor: string | null;
};

function historyCursor(
  snapshot: AgentRuntimeSnapshot,
  epoch: string,
  before: number,
): string | null {
  return before > 0
    ? JSON.stringify({
        epoch,
        before,
        id: agentForkMessageId(snapshot.messages[before], before),
      })
    : null;
}

export function windowAgentSnapshot(
  snapshot: AgentRuntimeSnapshot,
  epoch: string,
): AgentRuntimeSnapshot {
  const start = pageStart(snapshot.messages, snapshot.messages.length);
  if (start === 0) return snapshot;
  return {
    ...snapshot,
    messages: snapshot.messages.slice(start),
    history: { beforeCursor: historyCursor(snapshot, epoch, start) },
  };
}

export function agentHistoryPage(
  snapshot: AgentRuntimeSnapshot,
  cursor: AgentRuntimeCursor,
  anchor: string,
): AgentHistoryPage {
  const value = JSON.parse(anchor) as {
    epoch?: unknown;
    before?: unknown;
    id?: unknown;
  };
  if (
    value.epoch !== cursor.epoch ||
    !Number.isSafeInteger(value.before) ||
    Number(value.before) < 1 ||
    Number(value.before) >= snapshot.messages.length ||
    value.id !==
      agentForkMessageId(
        snapshot.messages[Number(value.before)],
        Number(value.before),
      )
  ) {
    throw new Error(
      "Agent history changed. Reopen the session to load older messages.",
    );
  }
  const end = Number(value.before);
  const start = pageStart(snapshot.messages, end);
  return {
    sessionId: snapshot.sessionId,
    cursor,
    anchor,
    messages: snapshot.messages.slice(start, end),
    beforeCursor: historyCursor(snapshot, cursor.epoch, start),
  };
}

export function isAgentHistoryPage(value: unknown): value is AgentHistoryPage {
  if (!value || typeof value !== "object") return false;
  const p = value as AgentHistoryPage;
  return (
    typeof p.sessionId === "string" &&
    typeof p.anchor === "string" &&
    Array.isArray(p.messages) &&
    (p.beforeCursor === null || typeof p.beforeCursor === "string") &&
    !!p.cursor &&
    typeof p.cursor.epoch === "string" &&
    Number.isSafeInteger(p.cursor.sequence) &&
    p.cursor.sequence >= 0
  );
}
