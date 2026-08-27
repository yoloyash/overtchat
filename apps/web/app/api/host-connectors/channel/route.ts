import {
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorProtocolVersion,
  parseHostConnectorCapabilities,
  type HostConnectorCommand,
} from "@overtchat/agent-bridge";
import { authenticateHostConnector } from "@/lib/agents/connector/auth";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { listActiveAgentSessionIds } from "@/lib/db/agentConnections";
import { touchHostConnector } from "@/lib/db/hostConnectors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const connector = authenticateHostConnector(request);
  if (!connector) return new Response("Unauthorized", { status: 401 });
  const protocol = Number(
    request.headers.get("x-overtchat-connector-protocol"),
  );
  const connectorBuildVersion = request.headers
    .get("x-overtchat-connector-build-version")
    ?.trim();
  if (!isHostConnectorProtocolVersion(protocol)) {
    return Response.json(
      {
        error:
          "The OvertChat app and Host Connector use incompatible protocols. Run `overtchat update` on the OvertChat host.",
        code: "unsupported_connector_protocol",
        supportedProtocolVersions: [HOST_CONNECTOR_PROTOCOL_VERSION],
      },
      { status: 409 },
    );
  }
  const capabilities = parseHostConnectorCapabilities(
    request.headers.get("x-overtchat-connector-capabilities"),
  );
  touchHostConnector(connector.id, connectorBuildVersion || undefined);
  const activeSessionIds = await listActiveAgentSessionIds(connector.id);

  let close = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const encoder = new TextEncoder();
      const send = (command: HostConnectorCommand) => {
        if (closed) throw new Error("Host Connector channel is closed.");
        controller.enqueue(encoder.encode(`${JSON.stringify(command)}\n`));
      };
      const unregister = hostConnectorBroker.register(
        connector.id,
        activeSessionIds,
        send,
        capabilities,
      );
      const keepAlive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode("\n"));
          } catch {
            finish();
          }
        }
      }, 15_000);
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unregister();
        try {
          controller.close();
        } catch {
          // The connector may have already closed the response stream.
        }
      };
      request.signal.addEventListener("abort", finish, { once: true });
      close = finish;
    },
    cancel() {
      close();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
