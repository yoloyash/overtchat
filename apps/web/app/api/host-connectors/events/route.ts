import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  HOST_CONNECTOR_RELEASE_VERSION,
  isHostConnectorEvent,
  isHostConnectorProtocolVersion,
  type HostConnectorEventBatch,
} from "@overtchat/agent-bridge";
import { authenticateHostConnector } from "@/lib/agents/connector/auth";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { touchHostConnector } from "@/lib/db/hostConnectors";

export async function POST(request: Request) {
  const connector = authenticateHostConnector(request);
  if (!connector) return new Response("Unauthorized", { status: 401 });
  if (
    request.headers.get("x-overtchat-connector-version") !==
      HOST_CONNECTOR_RELEASE_VERSION ||
    !isHostConnectorProtocolVersion(
      Number(request.headers.get("x-overtchat-connector-protocol")),
    )
  ) {
    return Response.json(
      { error: "The Host Connector release does not match this server." },
      { status: 409 },
    );
  }
  const batch = (await request.json().catch(() => null)) as
    | HostConnectorEventBatch
    | null;
  if (
    !batch ||
    !isHostConnectorProtocolVersion(batch.protocolVersion) ||
    typeof batch.connectorEpoch !== "string" ||
    batch.connectorEpoch.length === 0 ||
    !Array.isArray(batch.events) ||
    batch.events.length > HOST_CONNECTOR_EVENT_BATCH_LIMIT ||
    !batch.events.every(isHostConnectorEvent)
  ) {
    return Response.json({ error: "Invalid connector event batch." }, { status: 400 });
  }
  const ack = hostConnectorBroker.acceptBatch(
    connector.id,
    batch.connectorEpoch,
    batch.events,
  );
  touchHostConnector(connector.id);
  return Response.json(ack);
}
