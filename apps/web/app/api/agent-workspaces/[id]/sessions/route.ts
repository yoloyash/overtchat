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
import {
  getOwnedAgentWorkspace,
  upsertAgentSession,
} from "@/lib/db/agentConnections";
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
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });

  try {
    const sessionId = crypto.randomUUID();
    const created = await hostConnectorBroker.request<{
      session: unknown;
      snapshot: unknown;
    }>(owned.host.connectorId, {
      type: "create_session",
      sessionId,
      workspace: daemonWorkspace(owned),
    });
    const row = await upsertAgentSession(
      owned.workspace.id,
      parseProviderSessionMetadata(created.session),
      sessionId,
    );
    return Response.json(
      {
        session: {
          id: row.id,
          snapshot: created.snapshot,
        },
      },
      { status: 201 },
    );
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
