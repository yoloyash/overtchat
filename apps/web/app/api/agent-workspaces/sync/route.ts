import { auth } from "@/lib/auth/server";
import { connectionAccessError, connectionErrorMessage } from "@/lib/agents/access";
import { refreshAgentWorkspaces } from "@/lib/agents/connector/providerSnapshots";

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  try {
    return Response.json({ result: await refreshAgentWorkspaces(session.user.id) });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
