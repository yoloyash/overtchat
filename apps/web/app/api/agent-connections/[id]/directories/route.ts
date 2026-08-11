import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonTarget } from "@/lib/agents/connector/descriptors";
import { getOwnedAgentConnection } from "@/lib/db/agentConnections";

export const maxDuration = 30;

export async function GET(
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
  const owned = await getOwnedAgentConnection(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });

  const path = new URL(req.url).searchParams.get("path")?.trim() || undefined;
  if (path && (path.length > 4_096 || !path.startsWith("/"))) {
    return Response.json(
      { error: "Enter an absolute directory path." },
      { status: 400 },
    );
  }

  try {
    const directory = await hostConnectorBroker.request(
      owned.host.connectorId,
      {
        type: "list_directories",
        target: daemonTarget(owned.host, owned.connection.shellMode),
        ...(path ? { path } : {}),
      },
    );
    return Response.json({ directory });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
