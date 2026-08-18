import "server-only";
import type {
  AgentDaemonSessionDescriptor,
  AgentDaemonTarget,
  AgentDaemonWorkspaceDescriptor,
  AgentProviderSessionMetadata,
  AgentProviderId,
  AgentSessionLaunchConfig,
  ConnectorShellMode,
} from "@overtchat/agent-bridge";
import type {
  AgentHostRow,
  OwnedAgentSession,
  OwnedAgentWorkspace,
} from "@/lib/db/agentConnections";

export function daemonTarget(
  host: Pick<AgentHostRow, "transport" | "sshAlias">,
  shellMode?: ConnectorShellMode,
): AgentDaemonTarget {
  return host.transport === "local"
    ? { transport: "local", shellMode }
    : {
        transport: "ssh",
        alias: host.sshAlias ?? "",
        shellMode,
      };
}

export function daemonWorkspace(
  owned: OwnedAgentWorkspace,
): AgentDaemonWorkspaceDescriptor {
  return {
    connectionId: owned.connection.id,
    workspaceId: owned.workspace.id,
    provider: owned.connection.provider as AgentProviderId,
    target: daemonTarget(owned.host, owned.connection.shellMode),
    executable: owned.connection.executable,
    cwd: owned.workspace.path,
    detectedVersion: owned.connection.detectedVersion,
  };
}

export function daemonSession(
  owned: OwnedAgentSession,
): AgentDaemonSessionDescriptor {
  return {
    ...daemonWorkspace(owned),
    sessionId: owned.agentSession.id,
    providerSessionId: owned.agentSession.providerSessionId,
    providerSessionPath: owned.agentSession.providerSessionPath,
    launchConfig: {
      ...(owned.agentSession.model
        ? { model: owned.agentSession.model }
        : {}),
      ...(owned.agentSession.thinkingOptionId
        ? { thinkingOptionId: owned.agentSession.thinkingOptionId }
        : {}),
      ...(owned.agentSession.modeId ? { modeId: owned.agentSession.modeId } : {}),
    } as AgentSessionLaunchConfig,
  };
}

function optionalDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string | number | Date);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseProviderSessionMetadata(
  value: unknown,
): AgentProviderSessionMetadata {
  if (!value || typeof value !== "object") {
    throw new Error("The Host Connector returned invalid session metadata.");
  }
  const providerSessionId = Reflect.get(value, "providerSessionId");
  const providerSessionPath = Reflect.get(value, "providerSessionPath");
  const name = Reflect.get(value, "name");
  const firstMessage = Reflect.get(value, "firstMessage");
  const messageCount = Reflect.get(value, "messageCount");
  if (
    typeof providerSessionId !== "string" ||
    !providerSessionId ||
    typeof providerSessionPath !== "string" ||
    !providerSessionPath ||
    (name !== null && typeof name !== "string") ||
    (firstMessage !== null && typeof firstMessage !== "string") ||
    !Number.isSafeInteger(messageCount) ||
    Number(messageCount) < 0
  ) {
    throw new Error("The Host Connector returned invalid session metadata.");
  }
  return {
    providerSessionId,
    providerSessionPath,
    name,
    firstMessage,
    messageCount: Number(messageCount),
    createdAt: optionalDate(Reflect.get(value, "createdAt")),
    modifiedAt: optionalDate(Reflect.get(value, "modifiedAt")),
  };
}
