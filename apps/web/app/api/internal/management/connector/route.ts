import os from "node:os";
import { z } from "zod";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  getManagedHostConnector,
  provisionManagedHostConnector,
} from "@/lib/db/hostConnectors";
import { managementRequestAuthorized } from "@/lib/management/auth";

const inputSchema = z.object({
  name: z.string().trim().min(1).max(120).default(os.hostname()),
  version: z.string().trim().min(1).max(40).nullable(),
});

export async function GET(request: Request) {
  if (!managementRequestAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const connector = getManagedHostConnector();
  return Response.json({
    connector: connector
      ? {
          id: connector.id,
          name: connector.name,
          version: connector.version,
          online: hostConnectorBroker.isOnline(connector.id),
        }
      : null,
  });
}

export async function PUT(request: Request) {
  if (!managementRequestAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const parsed = inputSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid connector." },
      { status: 400 },
    );
  }
  const provisioned = provisionManagedHostConnector(parsed.data);
  return Response.json({
    connectorId: provisioned.connector.id,
    token: provisioned.token,
  });
}
