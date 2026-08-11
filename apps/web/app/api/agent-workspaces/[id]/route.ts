import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  daemonWorkspace,
  parseProviderSessionMetadata,
} from "@/lib/agents/connector/descriptors";
import { isAgentProviderId } from "@overtchat/agent-bridge";
import {
  deleteAgentWorkspace,
  getOwnedAgentWorkspace,
  syncAgentWorkspaceSessions,
} from "@/lib/db/agentConnections";

export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const { id } = await params;
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  try {
    if (!isAgentProviderId(owned.connection.provider)) {
      throw new Error("This coding-agent provider is not supported.");
    }
    const sessions = await hostConnectorBroker.request<unknown[]>(
      owned.host.connectorId,
      {
        type: "list_sessions",
        workspace: daemonWorkspace(owned),
      },
    );
    const rows = syncAgentWorkspaceSessions(
      id,
      sessions.map(parseProviderSessionMetadata),
    );
    return Response.json({
      sessions: rows.map((row) => ({
        id: row.id,
        providerSessionId: row.providerSessionId,
        name: row.name,
        firstMessage: row.firstMessage,
        messageCount: row.messageCount,
        createdAt: row.providerCreatedAt?.getTime() ?? null,
        modifiedAt: row.providerModifiedAt?.getTime() ?? null,
        runtimeStatus: hostConnectorBroker.runtimeStatusForSession(row.id),
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error: connectionErrorMessage(
          error,
          isAgentProviderId(owned.connection.provider)
            ? owned.connection.provider
            : "pi",
        ),
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const { id } = await params;
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  await hostConnectorBroker
    .request(owned.host.connectorId, {
      type: "stop_workspace",
      workspaceId: id,
    })
    .catch(() => {});
  const deleted = await deleteAgentWorkspace(id, session.user.id);
  return deleted
    ? new Response(null, { status: 204 })
    : new Response("Not found", { status: 404 });
}
