import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  HOST_CONNECTOR_EVENT_BATCH_BYTES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorEvent,
  isHostConnectorProtocolVersion,
  isHostConnectorEventFragment,
  type HostConnectorEventBatch,
} from "@overtchat/agent-bridge";
import { authenticateHostConnector } from "@/lib/agents/connector/auth";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { touchHostConnector } from "@/lib/db/hostConnectors";
import { connectorEventFragments } from "@/lib/agents/connector/eventFragments";

export async function POST(request: Request) {
  const connector = authenticateHostConnector(request);
  if (!connector) return new Response("Unauthorized", { status: 401 });
  const protocol = Number(
    request.headers.get("x-overtchat-connector-protocol"),
  );
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
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > HOST_CONNECTOR_EVENT_BATCH_BYTES)
    return Response.json(
      { error: "Connector request exceeds the byte budget." },
      { status: 413 },
    );
  const batch = (await request
    .json()
    .catch(() => null)) as HostConnectorEventBatch | null;
  if (
    !batch ||
    !isHostConnectorProtocolVersion(batch.protocolVersion) ||
    typeof batch.connectorEpoch !== "string" ||
    batch.connectorEpoch.length === 0 ||
    !Array.isArray(batch.events) ||
    (batch.fragment !== undefined
      ? batch.events.length !== 0 ||
        !isHostConnectorEventFragment(batch.fragment)
      : batch.events.length === 0) ||
    batch.events.length > HOST_CONNECTOR_EVENT_BATCH_LIMIT ||
    !batch.events.every(isHostConnectorEvent)
  ) {
    return Response.json({ error: "Invalid connector event batch." }, { status: 400 });
  }
  try {
    const ack = batch.fragment
      ? await connectorEventFragments.accept(
          connector.id,
          batch.connectorEpoch,
          batch.fragment,
          (event) =>
            hostConnectorBroker.acceptBatch(
              connector.id,
              batch.connectorEpoch,
              [event],
            ),
        )
      : await hostConnectorBroker.acceptBatch(
          connector.id,
          batch.connectorEpoch,
          batch.events,
        );
    const connectorBuildVersion = request.headers
      .get("x-overtchat-connector-build-version")
      ?.trim();
    touchHostConnector(
      connector.id,
      connectorBuildVersion || undefined,
    );
    return Response.json(ack);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid connector event batch.",
      },
      { status: 400 },
    );
  }
}
