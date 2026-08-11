import type {
  AgentConnectionListItem,
  AgentSessionListItem,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";

export const AGENT_SESSION_PREVIEW_COUNT = 8;

export function agentSessionIsRunning(
  session: AgentSessionListItem,
): boolean {
  return session.runtimeStatus === "running";
}

export function agentWorkspaceHasRunningSession(
  workspace: AgentWorkspaceListItem,
): boolean {
  return workspace.sessions.some(agentSessionIsRunning);
}

export function agentConnectionHasRunningSession(
  connection: AgentConnectionListItem,
): boolean {
  return connection.workspaces.some(agentWorkspaceHasRunningSession);
}

export function visibleAgentSessions(
  sessions: readonly AgentSessionListItem[],
  expanded: boolean,
  activeSessionId: string | null,
): AgentSessionListItem[] {
  if (expanded || sessions.length <= AGENT_SESSION_PREVIEW_COUNT) {
    return [...sessions];
  }
  const visible = sessions.slice(0, AGENT_SESSION_PREVIEW_COUNT);
  const additionallyVisible = sessions.filter(
    (session) =>
      (session.id === activeSessionId || agentSessionIsRunning(session)) &&
      !visible.some((candidate) => candidate.id === session.id),
  );
  return [...visible, ...additionallyVisible];
}
