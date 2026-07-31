import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { agentRuntimeRegistry } from "@/lib/agents/runtime/registry";
import { listPiWorkspaceSessions } from "@/lib/agents/pi/sessions";
import { targetForStoredHost } from "@/lib/agents/runtime/target";
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
  const { id } = await params;
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  const accessError = storedConnectionAccessError(
    session.user.role,
    owned.host,
  );
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  try {
    const sessions = await listPiWorkspaceSessions(
      targetForStoredHost(owned.host),
      owned.workspace.path,
    );
    const rows = syncAgentWorkspaceSessions(id, sessions);
    return Response.json({
      sessions: rows.map((row) => ({
        id: row.id,
        providerSessionId: row.providerSessionId,
        name: row.name,
        firstMessage: row.firstMessage,
        messageCount: row.messageCount,
        createdAt: row.providerCreatedAt?.getTime() ?? null,
        modifiedAt: row.providerModifiedAt?.getTime() ?? null,
      })),
    });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
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
  const { id } = await params;
  await agentRuntimeRegistry.stopWorkspace(id, session.user.id);
  const deleted = await deleteAgentWorkspace(id, session.user.id);
  return deleted
    ? new Response(null, { status: 204 })
    : new Response("Not found", { status: 404 });
}
