import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { inspectAgentWorkspaceGitStatus } from "@/lib/agents/runtime/git";
import { targetForStoredHost } from "@/lib/agents/runtime/target";
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

  try {
    const status = await inspectAgentWorkspaceGitStatus(
      targetForStoredHost(owned.host, owned.connection.shellMode),
      owned.workspace.path,
    );
    return Response.json(
      { status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
