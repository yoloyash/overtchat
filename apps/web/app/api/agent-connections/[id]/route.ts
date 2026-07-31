import { auth } from "@/lib/auth/server";
import {
  deleteAgentConnection,
  getOwnedAgentConnection,
  touchAgentConnectionValidation,
} from "@/lib/db/agentConnections";
import { targetForStoredHost } from "@/lib/agents/runtime/target";
import { probePiTarget } from "@/lib/agents/pi/probe";
import { connectionErrorMessage } from "@/lib/agents/access";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { agentRuntimeRegistry } from "@/lib/agents/runtime/registry";

export const maxDuration = 150;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const owned = await getOwnedAgentConnection(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  const accessError = storedConnectionAccessError(
    session.user.role,
    owned.host,
  );
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  try {
    const probe = await probePiTarget(
      targetForStoredHost(owned.host),
      owned.connection.executable,
    );
    await touchAgentConnectionValidation(
      id,
      session.user.id,
      probe.version,
    );
    return Response.json({ probe });
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
  await agentRuntimeRegistry.stopConnection(id, session.user.id);
  const deleted = await deleteAgentConnection(id, session.user.id);
  return deleted
    ? new Response(null, { status: 204 })
    : new Response("Not found", { status: 404 });
}
