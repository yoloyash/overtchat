import { auth } from "@/lib/auth/server";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { daemonWorkspace } from "@/lib/agents/connector/descriptors";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";
import { terminalRelay } from "@/lib/agents/terminal/server";
import { isAgentTerminalSize, TERMINAL_SOCKET_PATH } from "@overtchat/agent-bridge";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (storedConnectionAccessError(session.user.role)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const owned = await getOwnedAgentSession(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  const size: unknown = await request.json().catch(() => null);
  if (!isAgentTerminalSize(size)) return new Response("Invalid terminal size", { status: 400 });
  if (hostConnectorBroker.isOnline(owned.host.connectorId) && !hostConnectorBroker.supports(owned.host.connectorId, "workspace-terminal-v1")) {
    return Response.json({ error: "Update the Host Connector and enable workspace terminal support." }, { status: 409 });
  }
  try {
    const ticket = terminalRelay.issue({
      connectorId: owned.host.connectorId,
      workspace: daemonWorkspace(owned),
      size,
      origin: request.headers.get("origin") ?? new URL(request.url).origin,
      authorize: async () => {
        const current = await auth.api.getSession({ headers: request.headers });
        if (!current || current.session.id !== session.session.id || storedConnectionAccessError(current.user.role)) return false;
        const latest = await getOwnedAgentSession(id, current.user.id);
        return !!latest && latest.host.connectorId === owned.host.connectorId &&
          latest.connection.id === owned.connection.id &&
          latest.host.transport === owned.host.transport && latest.host.sshAlias === owned.host.sshAlias &&
          latest.workspace.id === owned.workspace.id && latest.workspace.path === owned.workspace.path;
      },
    });
    return Response.json({ ticket, path: TERMINAL_SOCKET_PATH }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Terminal unavailable." }, { status: 503 });
  }
}
