import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { createAgentWorkspaceProviderSession } from "@/lib/agents/connector/providerSnapshots";
import { getOwnedAgentWorkspace } from "@/lib/db/agentConnections";
import {
  agentSessionLaunchConfigSchema,
  isAgentProviderId,
} from "@overtchat/agent-bridge";

export const maxDuration = 150;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const { id } = await params;
  const owned = await getOwnedAgentWorkspace(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  let errorProvider = isAgentProviderId(owned.connection.provider)
    ? owned.connection.provider
    : "pi";

  try {
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const requestedProvider = body.provider;
    const provider =
      typeof requestedProvider === "string" && isAgentProviderId(requestedProvider)
      ? requestedProvider
      : isAgentProviderId(owned.connection.provider)
        ? owned.connection.provider
        : null;
    if (!provider) throw new Error("This coding-agent provider is not supported.");
    errorProvider = provider;
    const launchConfig = agentSessionLaunchConfigSchema.parse(
      body.launchConfig ?? body,
    );
    const created = await createAgentWorkspaceProviderSession({
      userId: session.user.id,
      anchorWorkspaceId: id,
      provider,
      launchConfig,
    });
    return Response.json(
      {
        session: {
          id: created.session.id,
          launchConfig: created.launchConfig,
          snapshot: created.snapshot,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error: connectionErrorMessage(error, errorProvider),
      },
      { status: 400 },
    );
  }
}
