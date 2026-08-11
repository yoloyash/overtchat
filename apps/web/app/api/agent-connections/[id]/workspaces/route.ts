import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { addAgentWorkspaceSchema } from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  daemonTarget,
  parseProviderSessionMetadata,
} from "@/lib/agents/connector/descriptors";
import { isAgentProviderId } from "@overtchat/agent-bridge";
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
    const target = daemonTarget(owned.host, owned.connection.shellMode);
    const workspace = await hostConnectorBroker.request<{
      path: string;
      name: string;
    }>(owned.host.connectorId, {
      type: "probe_workspace",
      target,
      path: parsed.data.path,
    });
    const workspaceId = crypto.randomUUID();
    const providerSessions = await hostConnectorBroker.request<unknown[]>(
      owned.host.connectorId,
      {
        type: "list_sessions",
        workspace: {
          connectionId: owned.connection.id,
          workspaceId,
          provider: owned.connection.provider,
          target,
          executable: owned.connection.executable,
          cwd: workspace.path,
          detectedVersion: owned.connection.detectedVersion,
        },
      },
    );
    const metadata = providerSessions.map(parseProviderSessionMetadata);
    const row = await createAgentWorkspace(
      id,
      session.user.id,
      {
        path: workspace.path,
        name: parsed.data.name ?? workspace.name,
      },
      workspaceId,
    );
    if (!row) return new Response("Not found", { status: 404 });
    const sessions = syncAgentWorkspaceSessions(
      row.id,
      metadata,
    );
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
