import {
  HOST_CONNECTOR_RELEASE_VERSION,
  normalizeHostConnectorServerUrl,
} from "@overtchat/agent-bridge";
import { auth } from "@/lib/auth/server";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  createHostConnectorPairing,
  deleteHostConnector,
  getOwnedHostConnector,
  listHostConnectors,
} from "@/lib/db/hostConnectors";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function connectorServerUrl(): string {
  return normalizeHostConnectorServerUrl(
    process.env.HOST_CONNECTOR_URL ?? "http://127.0.0.1:4718",
  );
}

function installCommand(pairCode: string): string {
  const installUrl = `https://overtchat.com/install/connector/${HOST_CONNECTOR_RELEASE_VERSION}`;
  return [
    "curl --proto '=https' --tlsv1.2 -fsSL ",
    installUrl,
    " | sh -s -- --server ",
    shellQuote(connectorServerUrl()),
    " --pair-code ",
    shellQuote(pairCode),
  ].join("");
}

async function adminUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return {
      ok: false as const,
      error: new Response("Unauthorized", { status: 401 }),
    };
  }
  if (session.user.role !== "admin") {
    return {
      ok: false as const,
      error: new Response("Forbidden", { status: 403 }),
    };
  }
  return { ok: true as const, user: session.user };
}

export async function GET(request: Request) {
  const result = await adminUser(request);
  if (!result.ok) return result.error;
  const connectors = listHostConnectors(result.user.id).map((connector) => ({
    id: connector.id,
    name: connector.name,
    version: connector.version,
    lastSeenAt: connector.lastSeenAt?.getTime() ?? null,
    online: hostConnectorBroker.isOnline(connector.id),
  }));
  return Response.json({ connectors });
}

export async function POST(request: Request) {
  const result = await adminUser(request);
  if (!result.ok) return result.error;
  const pairing = createHostConnectorPairing(result.user.id);
  return Response.json({
    pairCode: pairing.pairCode,
    expiresAt: pairing.expiresAt.getTime(),
    command: installCommand(pairing.pairCode),
  });
}

export async function DELETE(request: Request) {
  const result = await adminUser(request);
  if (!result.ok) return result.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing connector id", { status: 400 });
  if (!getOwnedHostConnector(id, result.user.id)) {
    return new Response("Not found", { status: 404 });
  }
  await hostConnectorBroker.request(id, { type: "stop_all" }).catch(() => {});
  return deleteHostConnector(id, result.user.id)
    ? new Response(null, { status: 204 })
    : new Response("Not found", { status: 404 });
}
