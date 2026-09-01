import { auth } from "@/lib/auth/server";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonTarget } from "@/lib/agents/connector/descriptors";
import { getOwnedAgentWorkspace } from "@/lib/db/agentConnections";

export const maxDuration = 30;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  const { id } = await params;
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  if (
    hostConnectorBroker.isOnline(owned.host.connectorId) &&
    !hostConnectorBroker.supports(
      owned.host.connectorId,
      "workspace-files-v1",
    )
  ) {
    return Response.json(
      { error: "Update the OvertChat Host Connector to browse workspace files." },
      { status: 426 },
    );
  }

  const directoryPath = new URL(req.url).searchParams.get("path") ?? ".";
  try {
    const listing = await hostConnectorBroker.request(
      owned.host.connectorId,
      {
        type: "list_workspace_directory",
        target: daemonTarget(owned.host, owned.connection.shellMode),
        root: owned.workspace.path,
        path: directoryPath,
      },
    );
    return Response.json(
      { listing },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
