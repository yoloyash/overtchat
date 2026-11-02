import {
  HOST_CONNECTOR_INSECURE_HTTP_FLAG,
  HOST_CONNECTOR_RELEASE_VERSION,
  HostConnectorServerUrlError,
  isInsecureHostConnectorServerUrl,
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

function allowInsecureHttp(): boolean {
  return ["1", "true", "yes"].includes(
    (process.env.HOST_CONNECTOR_ALLOW_INSECURE_HTTP ?? "").trim().toLowerCase(),
  );
}

type ConnectorServerTarget = { url: string; insecure: boolean };

let warnedInsecure = false;

/** Throws HostConnectorServerUrlError when HOST_CONNECTOR_URL is unusable. */
function connectorServerTarget(): ConnectorServerTarget {
  const configured = process.env.HOST_CONNECTOR_URL ?? "http://127.0.0.1:4718";
  const url = normalizeHostConnectorServerUrl(configured, {
    allowInsecureHttp: allowInsecureHttp(),
  });
  const insecure = isInsecureHostConnectorServerUrl(url);
  if (insecure && !warnedInsecure) {
    warnedInsecure = true;
    console.warn(
      `[host-connectors] HOST_CONNECTOR_ALLOW_INSECURE_HTTP is set: connectors pair with ${url} over cleartext HTTP. Anyone on that network path can read the connector token.`,
    );
  }
  return { url, insecure };
}

function connectorUrlProblem(error: HostConnectorServerUrlError): string {
  const configured = process.env.HOST_CONNECTOR_URL ?? "";
  switch (error.code) {
    case "insecure_connector_url":
      return `HOST_CONNECTOR_URL (${configured}) uses plain HTTP to an address other than this machine. Use an HTTPS address, or set HOST_CONNECTOR_ALLOW_INSECURE_HTTP=true on the server if this is a trusted private network.`;
    case "unsupported_connector_url_protocol":
      return `HOST_CONNECTOR_URL (${configured}) must start with http:// or https://.`;
    case "invalid_connector_url":
      return `HOST_CONNECTOR_URL (${configured}) is not a valid URL.`;
  }
}

function connectorInstallerUrl(): string {
  return `https://overtchat.com/install/connector/${HOST_CONNECTOR_RELEASE_VERSION}`;
}

function installCommand(
  target: ConnectorServerTarget,
  pairCode: string,
): string {
  return [
    "curl --proto '=https' --tlsv1.2 -fsSL ",
    connectorInstallerUrl(),
    " | sh -s -- --server ",
    shellQuote(target.url),
    " --pair-code ",
    shellQuote(pairCode),
    target.insecure ? ` ${HOST_CONNECTOR_INSECURE_HTTP_FLAG}` : "",
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
  let target: ConnectorServerTarget;
  try {
    target = connectorServerTarget();
  } catch (error) {
    if (!(error instanceof HostConnectorServerUrlError)) throw error;
    return Response.json(
      { error: connectorUrlProblem(error), code: error.code },
      { status: 400 },
    );
  }
  const pairing = createHostConnectorPairing(result.user.id);
  return Response.json({
    pairCode: pairing.pairCode,
    expiresAt: pairing.expiresAt.getTime(),
    command: installCommand(target, pairing.pairCode),
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
