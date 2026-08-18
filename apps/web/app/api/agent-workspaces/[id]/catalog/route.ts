import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonWorkspace } from "@/lib/agents/connector/descriptors";
import { getOwnedAgentWorkspace } from "@/lib/db/agentConnections";
import {
  agentProviderCatalogSchema,
  isAgentProviderId,
} from "@overtchat/agent-bridge";

export const maxDuration = 150;

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
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });

  try {
    const response = await hostConnectorBroker.request<unknown>(
      owned.host.connectorId,
      { type: "get_catalog", workspace: daemonWorkspace(owned) },
    );
    const catalog = agentProviderCatalogSchema.parse(response);
    if (catalog.provider !== owned.connection.provider) {
      throw new Error("The connector returned a catalog for another provider.");
    }
    return Response.json(catalog);
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
