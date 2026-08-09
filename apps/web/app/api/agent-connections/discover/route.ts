import { auth } from "@/lib/auth/server";
import {
  connectionAccessError,
  connectionErrorMessage,
} from "@/lib/agents/access";
import {
  agentDiscoveryTargetSchema,
  type AgentDiscoveryTarget,
} from "@/lib/agents/types";
import { discoverAgentInstallations } from "@/lib/agents/runtime/discovery";
import type { HostTarget } from "@/lib/agents/runtime/process";
import { getOwnedHostConnector } from "@/lib/db/hostConnectors";

export const maxDuration = 30;

function hostTarget(target: AgentDiscoveryTarget): HostTarget {
  return target.transport === "local"
    ? { connectorId: target.connectorId, transport: "local" }
    : {
        connectorId: target.connectorId,
        transport: "ssh",
        alias: target.sshAlias,
      };
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  const parsed = agentDiscoveryTargetSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid host." },
      { status: 400 },
    );
  }
  if (!getOwnedHostConnector(parsed.data.connectorId, session.user.id)) {
    return new Response("Host Connector not found", { status: 404 });
  }

  try {
    return Response.json({
      installations: await discoverAgentInstallations(
        hostTarget(parsed.data),
      ),
    });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
