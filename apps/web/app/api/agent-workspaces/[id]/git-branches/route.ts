import {
  isAgentWorkspaceGitBranches,
  isAgentWorkspaceGitSwitchResult,
  isAgentWorkspaceGitSwitchTarget,
} from "@overtchat/agent-bridge";
import { auth } from "@/lib/auth/server";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonTarget } from "@/lib/agents/connector/descriptors";
import { getOwnedAgentWorkspace } from "@/lib/db/agentConnections";

// A checkout of a large repository may take up to the connector's two minutes.
export const maxDuration = 150;

type RouteContext = { params: Promise<{ id: string }> };

// Git's own messages are the useful ones here; the agent-installation mapping
// would misread "not found" in them.
function errorResponse(error: unknown): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 },
  );
}

async function authorizedWorkspace(req: Request, { params }: RouteContext) {
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
    !hostConnectorBroker.supports(owned.host.connectorId, "workspace-git-branch-v1")
  ) {
    return {
      response: Response.json(
        { error: "Update the OvertChat Host Connector to switch branches." },
        { status: 426 },
      ),
    };
  }
  return { owned };
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { owned, response } = await authorizedWorkspace(req, context);
  if (!owned) return response;
  try {
    const branches = await hostConnectorBroker.request(owned.host.connectorId, {
      type: "list_git_branches",
      target: daemonTarget(owned.host, owned.connection.shellMode),
      path: owned.workspace.path,
    });
    if (!isAgentWorkspaceGitBranches(branches)) {
      throw new Error("The Host Connector returned invalid Git branches.");
    }
    return Response.json({ branches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { owned, response } = await authorizedWorkspace(req, context);
  if (!owned) return response;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    !isAgentWorkspaceGitSwitchTarget(body.branch) ||
    (body.stash !== undefined && typeof body.stash !== "boolean")
  ) {
    return Response.json({ error: "Choose a valid branch." }, { status: 400 });
  }
  try {
    const result = await hostConnectorBroker.request(owned.host.connectorId, {
      type: "switch_git_branch",
      target: daemonTarget(owned.host, owned.connection.shellMode),
      path: owned.workspace.path,
      branch: body.branch,
      stash: body.stash === true,
    });
    if (!isAgentWorkspaceGitSwitchResult(result)) {
      throw new Error("The Host Connector returned an invalid branch switch result.");
    }
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
