import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { agentRuntimeRegistry } from "@/lib/agents/runtime/registry";
import { getOwnedAgentWorkspace } from "@/lib/db/agentConnections";
import { isAgentProviderId } from "@/lib/agents/catalog";

export const maxDuration = 150;

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
    const created = await agentRuntimeRegistry.create(owned);
    return Response.json(
      {
        session: {
          id: created.sessionId,
          snapshot: created.runtime.snapshot(),
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
