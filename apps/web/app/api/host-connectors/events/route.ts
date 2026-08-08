import {
  isHostConnectorEvent,
  isHostConnectorProtocolVersion,
  type HostConnectorEventBatch,
} from "@overtchat/agent-bridge";
import { authenticateHostConnector } from "@/lib/agents/connector/auth";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { touchHostConnector } from "@/lib/db/hostConnectors";

const MAX_EVENTS = 1_000;

export async function POST(request: Request) {
  const connector = authenticateHostConnector(request);
  if (!connector) return new Response("Unauthorized", { status: 401 });
  const batch = (await request.json().catch(() => null)) as
    | HostConnectorEventBatch
    | null;
  if (
    !batch ||
    !isHostConnectorProtocolVersion(batch.protocolVersion) ||
    !Array.isArray(batch.events) ||
    batch.events.length > MAX_EVENTS ||
    !batch.events.every(isHostConnectorEvent)
  ) {
    return Response.json({ error: "Invalid connector event batch." }, { status: 400 });
  }
  for (const event of batch.events) {
    hostConnectorBroker.accept(connector.id, event);
  }
  touchHostConnector(connector.id);
  return new Response(null, { status: 204 });
}
