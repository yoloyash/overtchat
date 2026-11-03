import { isAgentWorkspaceGitWorktreeInspection } from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonTarget } from "@/lib/agents/connector/descriptors";
import {
  authorizedGitWorkspace,
  gitErrorResponse,
  type WorkspaceRouteContext,
} from "@/lib/agents/connector/workspaceGitRoute";
import {
  deleteAgentWorkspace,
  listOwnedAgentWorkspaceFolderRows,
} from "@/lib/db/agentConnections";

// Deleting a large worktree may take up to the connector's two minutes.
export const maxDuration = 150;

async function authorizedWorktree(req: Request, context: WorkspaceRouteContext) {
  const authorized = await authorizedGitWorkspace(
    req,
    context,
    "workspace-git-worktree-v1",
    "Update the OvertChat Host Connector to remove worktrees.",
  );
  if (authorized.owned && authorized.owned.workspace.worktreeParentPath === null) {
    return {
      response: Response.json(
        { error: "This workspace is not a worktree created by OvertChat." },
        { status: 400 },
      ),
    };
  }
  return authorized;
}

/** Reports what removing the worktree would discard. */
export async function GET(req: Request, context: WorkspaceRouteContext): Promise<Response> {
  const { owned, response } = await authorizedWorktree(req, context);
  if (!owned) return response;
  try {
    const inspection = await hostConnectorBroker.request(owned.host.connectorId, {
      type: "inspect_git_worktree",
      target: daemonTarget(owned.host, owned.connection.shellMode),
      path: owned.workspace.path,
    });
    if (!isAgentWorkspaceGitWorktreeInspection(inspection)) {
      throw new Error("The Host Connector returned an invalid worktree inspection.");
    }
    return Response.json({ inspection }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}

/**
 * Stops the folder's agents, deletes the worktree from the host, and removes
 * the folder's workspaces. The worktree's branch is kept.
 */
export async function DELETE(req: Request, context: WorkspaceRouteContext): Promise<Response> {
  const { userId, owned, response } = await authorizedWorktree(req, context);
  if (!owned) return response;
  const rows = await listOwnedAgentWorkspaceFolderRows(owned, userId);
  for (const { workspace } of rows) {
    await hostConnectorBroker
      .request(owned.host.connectorId, { type: "stop_workspace", workspaceId: workspace.id })
      .catch(() => {});
  }
  try {
    await hostConnectorBroker.request(owned.host.connectorId, {
      type: "remove_git_worktree",
      target: daemonTarget(owned.host, owned.connection.shellMode),
      path: owned.workspace.path,
    });
  } catch (error) {
    return gitErrorResponse(error);
  }
  for (const { workspace } of rows) {
    await deleteAgentWorkspace(workspace.id, userId);
  }
  return new Response(null, { status: 204 });
}
