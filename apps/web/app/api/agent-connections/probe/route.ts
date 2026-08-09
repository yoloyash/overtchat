import { auth } from "@/lib/auth/server";
import {
  connectionAccessError,
  connectionErrorMessage,
} from "@/lib/agents/access";
import { agentConnectionDraftSchema } from "@/lib/agents/types";
import { agentProviderAdapter } from "@/lib/agents/providers/registry";
import { getOwnedHostConnector } from "@/lib/db/hostConnectors";

export const maxDuration = 150;

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  const parsed = agentConnectionDraftSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid connection." },
      { status: 400 },
    );
  }
  if (!getOwnedHostConnector(parsed.data.connectorId, session.user.id)) {
    return new Response("Host Connector not found", { status: 404 });
  }

  try {
    const probe = await agentProviderAdapter(
      parsed.data.provider,
    ).probeConnection(parsed.data);
    return Response.json({ probe });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error, parsed.data.provider) },
      { status: 400 },
    );
  }
}
