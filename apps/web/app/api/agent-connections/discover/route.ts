import { auth } from "@/lib/auth/server";
import {
  connectionAccessError,
  connectionErrorMessage,
} from "@/lib/agents/access";
import {
  agentDiscoveryTargetSchema,
  agentProviderSnapshotSchema,
} from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { getAvailableHostConnector } from "@/lib/db/hostConnectors";

export const maxDuration = 30;

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
  if (!getAvailableHostConnector(parsed.data.connectorId, session.user.id)) {
    return new Response("Host Connector not found", { status: 404 });
  }

  try {
    const refresh = new URL(request.url).searchParams.get("refresh") !== "0";
    const snapshot = agentProviderSnapshotSchema.parse(
      await hostConnectorBroker.request(parsed.data.connectorId, {
        type: "provider_snapshot",
        target: parsed.data,
        refresh,
      }),
    );
    return Response.json({
      snapshot,
      installations: snapshot.providers.flatMap((entry) =>
        entry.status === "ready"
          ? [
              {
                provider: entry.provider,
                executable: entry.executable,
                version: entry.version,
                shellMode: entry.shellMode,
              },
            ]
          : [],
      ),
    });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
