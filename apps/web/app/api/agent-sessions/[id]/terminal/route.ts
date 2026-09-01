import { auth } from "@/lib/auth/server";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonSession } from "@/lib/agents/connector/descriptors";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";
import {
  AGENT_TERMINAL_MAX_INPUT_CHARS,
  isAgentTerminalSize,
  type AgentTerminalSize,
} from "@overtchat/agent-bridge";

type TerminalControl =
  | { type: "input"; data: string }
  | { type: "resize"; size: AgentTerminalSize }
  | { type: "restart"; size: AgentTerminalSize }
  | { type: "kill" };

function parseControl(value: unknown): TerminalControl | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type === "input" &&
    typeof record.data === "string" &&
    record.data.length > 0 &&
    record.data.length <= AGENT_TERMINAL_MAX_INPUT_CHARS
  ) {
    return { type: "input", data: record.data };
  }
  if (
    (record.type === "resize" || record.type === "restart") &&
    isAgentTerminalSize(record.size)
  ) {
    return { type: record.type, size: record.size };
  }
  return record.type === "kill" ? { type: "kill" } : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authSession = await auth.api.getSession({ headers: req.headers });
  if (!authSession) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(authSession.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const { id } = await params;
  const owned = await getOwnedAgentSession(id, authSession.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  if (!hostConnectorBroker.isOnline(owned.host.connectorId)) {
    return Response.json(
      { error: "The OvertChat Host Connector is offline." },
      { status: 503 },
    );
  }
  if (
    !hostConnectorBroker.supports(
      owned.host.connectorId,
      "workspace-terminal-v1",
    )
  ) {
    return Response.json(
      {
        error:
          "Update the OvertChat Host Connector to use workspace terminals.",
      },
      { status: 426 },
    );
  }
  return Response.json(
    { available: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authSession = await auth.api.getSession({ headers: req.headers });
  if (!authSession) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(authSession.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const { id } = await params;
  const owned = await getOwnedAgentSession(id, authSession.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  if (
    hostConnectorBroker.isOnline(owned.host.connectorId) &&
    !hostConnectorBroker.supports(
      owned.host.connectorId,
      "workspace-terminal-v1",
    )
  ) {
    return Response.json(
      {
        error:
          "Update the OvertChat Host Connector to use workspace terminals.",
      },
      { status: 426 },
    );
  }
  const control = parseControl(await req.json().catch(() => null));
  if (!control) {
    return Response.json(
      { error: "Invalid terminal command." },
      { status: 400 },
    );
  }

  try {
    if (control.type === "input") {
      hostConnectorBroker.sendTerminalInput(
        owned.host.connectorId,
        id,
        control.data,
      );
      return new Response(null, { status: 204 });
    }
    if (control.type === "resize") {
      hostConnectorBroker.resizeTerminal(
        owned.host.connectorId,
        id,
        control.size,
      );
      return new Response(null, { status: 204 });
    }
    if (control.type === "restart") {
      const snapshot = await hostConnectorBroker.restartTerminal(
        owned.host.connectorId,
        daemonSession(owned),
        control.size,
      );
      return Response.json({ snapshot });
    }
    await hostConnectorBroker.killTerminal(owned.host.connectorId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
