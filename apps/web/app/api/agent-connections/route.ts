import { auth } from "@/lib/auth/server";
import {
  connectionAccessError,
  connectionErrorMessage,
} from "@/lib/agents/access";
import {
  agentConnectionDraftSchema,
  type AgentConnectionListItem,
} from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { withConnectorSessionDirectory } from "@/lib/agents/connector/directory";
import { getAvailableHostConnector } from "@/lib/db/hostConnectors";
import {
  createAgentConnection,
  listAgentConnections,
} from "@/lib/db/agentConnections";

export const maxDuration = 150;

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  return Response.json({
    connections: withConnectorSessionDirectory(
      await listAgentConnections(session.user.id),
    ),
  });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  const parsed = agentConnectionDraftSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid connection." },
      { status: 400 },
    );
  }
  const draft = parsed.data;
  if (!getAvailableHostConnector(draft.connectorId, session.user.id)) {
    return new Response("Host Connector not found", { status: 404 });
  }

  try {
    const probe = await hostConnectorBroker.request<{
      status: "ready";
      version: string;
      models: unknown[];
      shellMode: "interactive" | "login";
    }>(draft.connectorId, { type: "probe", draft });
    const owned = createAgentConnection({
      userId: session.user.id,
      host:
        draft.transport === "local"
          ? {
              name: draft.name,
              transport: "local",
              connectorId: draft.connectorId,
            }
          : {
              name: draft.name,
              transport: "ssh",
              connectorId: draft.connectorId,
              sshAlias: draft.sshAlias,
            },
      connection: {
        provider: draft.provider,
        executable: draft.executable,
        shellMode: probe.shellMode,
        detectedVersion: probe.version,
      },
    });
    const connections = withConnectorSessionDirectory(
      await listAgentConnections(session.user.id),
    );
    const connection = connections.find(
      (candidate) => candidate.id === owned.connection.id,
    ) as AgentConnectionListItem | undefined;
    if (!connection) throw new Error("The saved connection could not be read.");
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error, draft.provider) },
      { status: 400 },
    );
  }
}
