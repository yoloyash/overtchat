import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { addAgentWorkspaceSchema } from "@/lib/agents/types";
import { probeAgentWorkspace } from "@/lib/agents/runtime/filesystem";
import { agentProviderAdapter } from "@/lib/agents/providers/registry";
import { targetForStoredHost } from "@/lib/agents/runtime/target";
import { isAgentProviderId } from "@/lib/agents/catalog";
import {
  createAgentWorkspace,
  getOwnedAgentConnection,
  syncAgentWorkspaceSessions,
} from "@/lib/db/agentConnections";

export const maxDuration = 60;

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
  const parsed = addAgentWorkspaceSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid workspace." },
      { status: 400 },
    );
  }

  try {
    if (!isAgentProviderId(owned.connection.provider)) {
      throw new Error("This coding-agent provider is not supported.");
    }
    const target = targetForStoredHost(
      owned.host,
      owned.connection.shellMode,
    );
    const workspace = await probeAgentWorkspace(target, parsed.data.path);
    const providerSessions = await agentProviderAdapter(
      owned.connection.provider,
    ).listWorkspaceSessions(
      target,
      owned.connection.executable,
      workspace.path,
    );
    const row = await createAgentWorkspace(id, session.user.id, {
      path: workspace.path,
      name: parsed.data.name ?? workspace.name,
    });
    if (!row) return new Response("Not found", { status: 404 });
    const sessions = syncAgentWorkspaceSessions(row.id, providerSessions);
    return Response.json(
      {
        workspace: {
          id: row.id,
          path: row.path,
          name: row.name,
          sessions: sessions.map((agentSession) => ({
            id: agentSession.id,
            providerSessionId: agentSession.providerSessionId,
            name: agentSession.name,
            firstMessage: agentSession.firstMessage,
            messageCount: agentSession.messageCount,
            createdAt: agentSession.providerCreatedAt?.getTime() ?? null,
            modifiedAt: agentSession.providerModifiedAt?.getTime() ?? null,
            runtimeStatus: "idle",
          })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = connectionErrorMessage(
      error,
      isAgentProviderId(owned.connection.provider)
        ? owned.connection.provider
        : "pi",
    );
    return Response.json(
      {
        error: /UNIQUE constraint failed/u.test(message)
          ? "That workspace is already attached."
          : message,
      },
      { status: /UNIQUE constraint failed/u.test(message) ? 409 : 400 },
    );
  }
}
