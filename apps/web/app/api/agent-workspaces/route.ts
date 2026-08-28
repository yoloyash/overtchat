import { auth } from "@/lib/auth/server";
import { connectionAccessError, connectionErrorMessage } from "@/lib/agents/access";
import { createAgentWorkspaceSchema } from "@overtchat/agent-bridge";
import { provisionAgentWorkspace } from "@/lib/agents/connector/providerSnapshots";
import { getAvailableHostConnector } from "@/lib/db/hostConnectors";

export const maxDuration = 150;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const parsed = createAgentWorkspaceSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid workspace." },
      { status: 400 },
    );
  }
  if (
    !getAvailableHostConnector(parsed.data.target.connectorId, session.user.id)
  ) {
    return new Response("Host Connector not found", { status: 404 });
  }

  try {
    const result = await provisionAgentWorkspace({
      userId: session.user.id,
      ...parsed.data,
    });
    if (
      result.created + result.refreshed === 0 &&
      result.failures.length > 0
    ) {
      return Response.json(
        { error: result.failures.map(({ message }) => message).join(" ") },
        { status: 400 },
      );
    }
    if (result.providers === 0) {
      return Response.json(
        { error: "No supported coding agents were detected on this machine." },
        { status: 400 },
      );
    }
    return Response.json({ result }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
