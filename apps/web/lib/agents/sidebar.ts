import type {
  AgentConnectionListItem,
  AgentRuntimeStatus,
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

export function withAgentSessionRuntimeStatus(
  connections: AgentConnectionListItem[],
  sessionId: string,
  runtimeStatus: AgentRuntimeStatus,
): AgentConnectionListItem[] {
  let changed = false;
  const next = connections.map((connection) => {
    let connectionChanged = false;
    const workspaces = connection.workspaces.map((workspace) => {
      let workspaceChanged = false;
      const sessions = workspace.sessions.map((session) => {
        if (
          session.id !== sessionId ||
          session.runtimeStatus === runtimeStatus
        ) {
          return session;
        }
        changed = true;
        connectionChanged = true;
        workspaceChanged = true;
        return { ...session, runtimeStatus };
      });
      return workspaceChanged ? { ...workspace, sessions } : workspace;
    });
    return connectionChanged ? { ...connection, workspaces } : connection;
  });
  return changed ? next : connections;
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
