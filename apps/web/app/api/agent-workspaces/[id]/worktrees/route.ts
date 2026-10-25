import {
  isAgentProviderId,
  isAgentWorkspaceGitBaseRef,
  isAgentWorkspaceGitRefName,
  isAgentWorkspaceGitWorktree,
  type AgentDiscoveryTarget,
} from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonTarget } from "@/lib/agents/connector/descriptors";
import { provisionAgentWorkspace } from "@/lib/agents/connector/providerSnapshots";
import {
  authorizedGitWorkspace,
  gitErrorResponse,
  type WorkspaceRouteContext,
} from "@/lib/agents/connector/workspaceGitRoute";
import { findOwnedAgentWorkspaceForTargetProvider } from "@/lib/db/agentConnections";

// Checking out a large repository may take up to the connector's two minutes.
export const maxDuration = 150;

/** Creates a Git worktree from this workspace and adds it as a workspace of its own. */
export async function POST(req: Request, context: WorkspaceRouteContext): Promise<Response> {
  const { userId, owned, response } = await authorizedGitWorkspace(
    req,
    context,
    "workspace-git-worktree-v1",
    "Update the OvertChat Host Connector to create worktrees.",
  );
  if (!owned) return response;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isAgentWorkspaceGitBaseRef(body.base) || !isAgentWorkspaceGitRefName(body.branch)) {
    return Response.json({ error: "Choose a base branch and a new branch name." }, { status: 400 });
  }
  const provider = owned.connection.provider;
  if (!isAgentProviderId(provider)) {
    return Response.json({ error: "Unsupported coding agent." }, { status: 400 });
  }
  const daemon = daemonTarget(owned.host, owned.connection.shellMode);
  let worktree;
  try {
    worktree = await hostConnectorBroker.request(owned.host.connectorId, {
      type: "create_git_worktree",
      target: daemon,
      path: owned.workspace.path,
      base: body.base,
      branch: body.branch,
    });
    if (!isAgentWorkspaceGitWorktree(worktree)) {
      throw new Error("The Host Connector returned an invalid worktree.");
    }
  } catch (error) {
    return gitErrorResponse(error);
  }

  const target: AgentDiscoveryTarget =
    owned.host.transport === "local"
      ? { connectorId: owned.host.connectorId, transport: "local" }
      : {
          connectorId: owned.host.connectorId,
          transport: "ssh",
          sshAlias: owned.host.sshAlias!,
        };
  try {
    const result = await provisionAgentWorkspace({
      userId,
      target,
      path: worktree.path,
      name: worktree.name,
      // Worktrees of a worktree belong to the same repository workspace.
      worktreeParentPath: owned.workspace.worktreeParentPath ?? owned.workspace.path,
      installations: [
        {
          provider,
          executable: owned.connection.executable,
          version: owned.connection.detectedVersion ?? "configured",
          shellMode: owned.connection.shellMode,
        },
      ],
    });
    const created = await findOwnedAgentWorkspaceForTargetProvider({
      userId,
      target,
      provider,
      path: worktree.path,
    });
    if (!created) {
      throw new Error(result.failures[0]?.message ?? "The worktree could not be added.");
    }
    return Response.json(
      { worktree, workspaceId: created.workspace.id },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    await hostConnectorBroker
      .request(owned.host.connectorId, {
        type: "remove_git_worktree",
        target: daemon,
        path: worktree.path,
      })
      .catch(() => {});
    return gitErrorResponse(error);
  }
}
