import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
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
  const protocol = Number(
    request.headers.get("x-overtchat-connector-protocol"),
  );
  if (
    request.headers.get("x-overtchat-connector-version") !==
      HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE ||
    !isHostConnectorProtocolVersion(protocol)
  ) {
    return Response.json(
      {
        error: `The OvertChat app and Host Connector are out of date with each other. Run \`overtchat update\` on the OvertChat host (or reinstall connector ${HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE}).`,
        code: "unsupported_connector_protocol",
        supportedProtocolVersions: [HOST_CONNECTOR_PROTOCOL_VERSION],
        compatibilityRelease: HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
      },
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
    batch.events.length === 0 ||
    batch.events.length > HOST_CONNECTOR_EVENT_BATCH_LIMIT ||
    !batch.events.every(isHostConnectorEvent)
  ) {
    return Response.json({ error: "Invalid connector event batch." }, { status: 400 });
  }
  try {
    const ack = await hostConnectorBroker.acceptBatch(
      connector.id,
      batch.connectorEpoch,
      batch.events,
    );
    const connectorBuildVersion = request.headers
      .get("x-overtchat-connector-build-version")
      ?.trim();
    touchHostConnector(
      connector.id,
      connectorBuildVersion || HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
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
