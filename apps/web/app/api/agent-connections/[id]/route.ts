import { auth } from "@/lib/auth/server";
import {
  deleteAgentConnection,
  getOwnedAgentConnection,
  touchAgentConnectionValidation,
} from "@/lib/db/agentConnections";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { connectionErrorMessage } from "@/lib/agents/access";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { isAgentProviderId } from "@overtchat/agent-bridge";

export const maxDuration = 150;

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
  const owned = await getOwnedAgentConnection(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });

  try {
    if (!isAgentProviderId(owned.connection.provider)) {
      throw new Error("This coding-agent provider is not supported.");
    }
    const draft =
      owned.host.transport === "local"
        ? {
            connectorId: owned.host.connectorId,
            provider: owned.connection.provider,
            name: owned.host.name,
            executable: owned.connection.executable,
            transport: "local" as const,
          }
        : {
            connectorId: owned.host.connectorId,
            provider: owned.connection.provider,
            name: owned.host.name,
            executable: owned.connection.executable,
            transport: "ssh" as const,
            sshAlias: owned.host.sshAlias ?? "",
          };
    const probe = await hostConnectorBroker.request<{
      version: string;
      shellMode: "interactive" | "login";
    }>(owned.host.connectorId, { type: "probe", draft });
    await touchAgentConnectionValidation(
      id,
      session.user.id,
      probe.version,
      probe.shellMode,
    );
    return Response.json({ probe });
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
  const owned = await getOwnedAgentConnection(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  await hostConnectorBroker
    .request(owned.host.connectorId, {
      type: "stop_connection",
      connectionId: id,
    })
    .catch(() => {});
  const deleted = await deleteAgentConnection(id, session.user.id);
  return deleted
    ? new Response(null, { status: 204 })
    : new Response("Not found", { status: 404 });
}
