import type { AgentSessionListItem } from "@/lib/agents/types";

export const AGENT_SESSION_PREVIEW_COUNT = 8;

export function visibleAgentSessions(
  sessions: readonly AgentSessionListItem[],
  expanded: boolean,
  activeSessionId: string | null,
): AgentSessionListItem[] {
  if (expanded || sessions.length <= AGENT_SESSION_PREVIEW_COUNT) {
    return [...sessions];
  }
  const visible = sessions.slice(0, AGENT_SESSION_PREVIEW_COUNT);
  const active = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId)
    : undefined;
  return active && !visible.some((session) => session.id === active.id)
    ? [...visible, active]
    : visible;
}
