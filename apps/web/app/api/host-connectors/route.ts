import {
  HOST_CONNECTOR_RELEASE_VERSION,
  normalizeHostConnectorServerUrl,
} from "@overtchat/agent-bridge";
import { auth } from "@/lib/auth/server";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  createHostConnectorPairing,
  deleteHostConnector,
  getManagedHostConnector,
  getOwnedHostConnector,
  listAvailableHostConnectors,
} from "@/lib/db/hostConnectors";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function connectorServerUrl(): string {
  return normalizeHostConnectorServerUrl(
    process.env.HOST_CONNECTOR_URL ?? "http://127.0.0.1:4718",
  );
}

function connectorInstallerUrl(): string {
  return `https://overtchat.com/install/connector/${HOST_CONNECTOR_RELEASE_VERSION}`;
}

function installCommand(pairCode: string): string {
  return [
    "curl --proto '=https' --tlsv1.2 -fsSL ",
    connectorInstallerUrl(),
    " | sh -s -- --server ",
    shellQuote(connectorServerUrl()),
    " --pair-code ",
    shellQuote(pairCode),
  ].join("");
}

function upgradeCommand(): string {
  return [
    "curl --proto '=https' --tlsv1.2 -fsSL ",
    connectorInstallerUrl(),
    " | sh -s -- --upgrade",
  ].join("");
}

function connectorNeedsUpgrade(version: string | null): boolean {
  if (version === HOST_CONNECTOR_RELEASE_VERSION) return false;
  const current = /^(\d+)\.(\d+)\.(\d+)$/u.exec(
    HOST_CONNECTOR_RELEASE_VERSION,
  );
  const installed = version ? /^(\d+)\.(\d+)\.(\d+)$/u.exec(version) : null;
  if (!current || !installed) return true;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(installed[index]) - Number(current[index]);
    if (difference !== 0) return difference < 0;
  }
  return false;
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
  const connectors = listAvailableHostConnectors(result.user.id).map((connector) => {
    const needsUpgrade = connectorNeedsUpgrade(connector.version);
    return {
      id: connector.id,
      name: connector.name,
      managed: connector.managed,
      version: connector.version,
      lastSeenAt: connector.lastSeenAt?.getTime() ?? null,
      online: hostConnectorBroker.isOnline(connector.id),
      upgrade: needsUpgrade && !connector.managed
        ? {
            version: HOST_CONNECTOR_RELEASE_VERSION,
            command: upgradeCommand(),
          }
        : null,
    };
  });
  return Response.json({ connectors });
}

export async function POST(request: Request) {
  const result = await adminUser(request);
  if (!result.ok) return result.error;
  if (getManagedHostConnector()) {
    return Response.json(
      {
        error: "Agent Connections are managed by overtchat setup.",
        code: "managed_connector",
      },
      { status: 409 },
    );
  }
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
  const connector = getOwnedHostConnector(id, result.user.id);
  if (!connector) {
    return new Response("Not found", { status: 404 });
  }
  if (connector.managed) {
    return Response.json(
      {
        error: "Agent Connections are managed by overtchat setup.",
        code: "managed_connector",
      },
      { status: 409 },
    );
  }
  await hostConnectorBroker.request(id, { type: "stop_all" }).catch(() => {});
  return deleteHostConnector(id, result.user.id)
    ? new Response(null, { status: 204 })
    : new Response("Not found", { status: 404 });
}
