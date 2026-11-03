import {
  applyAgentSessionDirectoryEntry,
  type AgentConnectionListItem,
  type AgentSessionDirectoryEntry,
  type AgentSessionListItem,
  type AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";
import { agentSessionState } from "@/lib/agents/attention";

export const AGENT_SESSION_PREVIEW_COUNT = 7;

export {
  agentSessionDisplayTitle,
  withAgentSessionReadState,
} from "@overtchat/shared/agent-attention";

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

export function withAgentSessionDirectory(
  connections: AgentConnectionListItem[],
  sessions: readonly AgentSessionDirectoryEntry[],
): AgentConnectionListItem[] {
  const directory = new Map(
    sessions.map((session) => [session.sessionId, session]),
  );
  let changed = false;
  const next = connections.map((connection) => {
    let connectionChanged = false;
    const workspaces = connection.workspaces.map((workspace) => {
      let workspaceChanged = false;
      const workspaceSessions = workspace.sessions.map((session) => {
        const entry = directory.get(session.id);
        if (!entry) return session;
        const next = applyAgentSessionDirectoryEntry(session, entry);
        if (
          next.runtimeStatus === session.runtimeStatus &&
          next.turnStartedAt === (session.turnStartedAt ?? null) &&
          next.attention?.id === session.attention?.id &&
          next.lastTurn?.endedAt === session.lastTurn?.endedAt
        ) {
          return session;
        }
        changed = true;
        connectionChanged = true;
        workspaceChanged = true;
        return next;
      });
      return workspaceChanged
        ? { ...workspace, sessions: workspaceSessions }
        : workspace;
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
  // Sessions that are working or waiting on the owner stay visible.
  const additionallyVisible = sessions.filter(
    (session) =>
      (session.id === activeSessionId ||
        agentSessionState(session) !== "idle") &&
      !visible.some((candidate) => candidate.id === session.id),
  );
  return [...visible, ...additionallyVisible];
}
