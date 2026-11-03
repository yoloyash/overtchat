import "server-only";
import type { HostConnectorCapability } from "@overtchat/agent-bridge";
import { auth } from "@/lib/auth/server";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  getOwnedAgentWorkspace,
  type OwnedAgentWorkspace,
} from "@/lib/db/agentConnections";

export type WorkspaceRouteContext = { params: Promise<{ id: string }> };

/** Authorizes a Git operation on an owned workspace whose connector supports it. */
export async function authorizedGitWorkspace(
  req: Request,
  { params }: WorkspaceRouteContext,
  capability: HostConnectorCapability,
  updateMessage: string,
): Promise<
  | { userId: string; owned: OwnedAgentWorkspace; response?: never }
  | { userId?: never; owned?: never; response: Response }
> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { response: new Response("Unauthorized", { status: 401 }) };
  const accessError = storedConnectionAccessError(session.user.role);
  if (accessError) {
    return { response: Response.json({ error: accessError }, { status: 403 }) };
  }
  const { id } = await params;
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return { response: new Response("Not found", { status: 404 }) };
  if (
    hostConnectorBroker.isOnline(owned.host.connectorId) &&
    !hostConnectorBroker.supports(owned.host.connectorId, capability)
  ) {
    return {
      response: Response.json({ error: updateMessage }, { status: 426 }),
    };
  }
  return { userId: session.user.id, owned };
}

// Git's own messages are the useful ones here; the agent-installation mapping
// would misread "not found" in them.
export function gitErrorResponse(error: unknown): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 },
  );
}
