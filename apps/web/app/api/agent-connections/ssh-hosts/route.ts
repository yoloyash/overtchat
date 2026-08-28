import { auth } from "@/lib/auth/server";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { getAvailableHostConnector } from "@/lib/db/hostConnectors";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const connectorId = new URL(req.url).searchParams.get("connectorId");
  if (!connectorId) {
    return Response.json({ error: "Choose a Host Connector." }, { status: 400 });
  }
  if (!getAvailableHostConnector(connectorId, session.user.id)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    return Response.json({
      hosts: await hostConnectorBroker.listSshHosts(connectorId),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
