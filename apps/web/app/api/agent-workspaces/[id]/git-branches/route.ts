import {
  isAgentWorkspaceGitBranches,
  isAgentWorkspaceGitSwitchResult,
  isAgentWorkspaceGitSwitchTarget,
} from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonTarget } from "@/lib/agents/connector/descriptors";
import {
  authorizedGitWorkspace,
  gitErrorResponse,
  type WorkspaceRouteContext,
} from "@/lib/agents/connector/workspaceGitRoute";

// A checkout of a large repository may take up to the connector's two minutes.
export const maxDuration = 150;

function authorizedWorkspace(req: Request, context: WorkspaceRouteContext) {
  return authorizedGitWorkspace(
    req,
    context,
    "workspace-git-branch-v1",
    "Update the OvertChat Host Connector to switch branches.",
  );
}

export async function GET(req: Request, context: WorkspaceRouteContext): Promise<Response> {
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
    return gitErrorResponse(error);
  }
}

export async function POST(req: Request, context: WorkspaceRouteContext): Promise<Response> {
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
    return gitErrorResponse(error);
  }
}
