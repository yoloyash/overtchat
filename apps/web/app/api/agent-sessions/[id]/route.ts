import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { agentSessionCommandSchema } from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  daemonSession,
  daemonWorkspace,
  parseProviderSessionMetadata,
} from "@/lib/agents/connector/descriptors";
import {
  getOwnedAgentSession,
  type OwnedAgentSession,
  updateAgentSessionMetadata,
  upsertAgentSession,
} from "@/lib/db/agentConnections";
import { isAgentProviderId } from "@overtchat/agent-bridge";

export const maxDuration = 300;

async function authorize(
  req: Request,
  id: string,
): Promise<
  { error: Response } | { owned: OwnedAgentSession }
> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return { error: new Response("Unauthorized", { status: 401 }) } as const;
  }
  const accessError = storedConnectionAccessError(session.user.role);
  if (accessError) {
    return {
      error: Response.json({ error: accessError }, { status: 403 }),
    } as const;
  }
  const owned = await getOwnedAgentSession(id, session.user.id);
  if (!owned) {
    return { error: new Response("Not found", { status: 404 }) } as const;
  }
  return { owned };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const authorized = await authorize(req, id);
  if ("error" in authorized) return authorized.error;
  try {
    const result = await hostConnectorBroker.request<{
      snapshot: unknown;
    }>(authorized.owned.host.connectorId, {
      type: "open_session",
      session: daemonSession(authorized.owned),
    });
    return Response.json({ snapshot: result.snapshot });
  } catch (error) {
    return Response.json(
      {
        error: connectionErrorMessage(
          error,
          isAgentProviderId(authorized.owned.connection.provider)
            ? authorized.owned.connection.provider
            : "pi",
        ),
      },
      { status: 400 },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const authorized = await authorize(req, id);
  if ("error" in authorized) return authorized.error;
  const parsed = agentSessionCommandSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid command." },
      { status: 400 },
    );
  }

  try {
    const command = parsed.data;
    if (command.type === "new_session") {
      const sessionId = crypto.randomUUID();
      const created = await hostConnectorBroker.request<{
        session: unknown;
        snapshot: unknown;
      }>(authorized.owned.host.connectorId, {
        type: "create_session",
        sessionId,
        workspace: daemonWorkspace(authorized.owned),
      });
      const row = await upsertAgentSession(
        authorized.owned.workspace.id,
        parseProviderSessionMetadata(created.session),
        sessionId,
      );
      return Response.json({
        accepted: true,
        sessionId: row.id,
      });
    }
    const clientMessageId =
      "clientMessageId" in command ? command.clientMessageId : undefined;
    const result = await hostConnectorBroker.request<{
      commandResult?: unknown;
      snapshot?: { queuedMessages?: unknown[] };
      fork?: { session: unknown; draft?: string };
    }>(authorized.owned.host.connectorId, {
      type: "session_command",
      commandId: clientMessageId ?? crypto.randomUUID(),
      ...(clientMessageId ? { clientMessageId } : {}),
      session: daemonSession(authorized.owned),
      command,
    });
    if (result.fork) {
      const row = await upsertAgentSession(
        authorized.owned.workspace.id,
        parseProviderSessionMetadata(result.fork.session),
      );
      return Response.json({
        accepted: true,
        sessionId: row.id,
        ...(result.fork.draft !== undefined
          ? { draft: result.fork.draft }
          : {}),
      });
    }
    if (
      command.type === "prompt" ||
      command.type === "interrupt" ||
      command.type === "implement_plan" ||
      command.type === "steer" ||
      command.type === "steer_queued_message" ||
      command.type === "interrupt_queued_message"
    ) {
      await updateAgentSessionMetadata(id, {
        ...(
          command.type === "prompt" &&
          !authorized.owned.agentSession.firstMessage
          ? {
              firstMessage:
                command.message ||
                command.images?.[0]?.filename ||
                "Image attachment",
            }
          : {}),
        providerModifiedAt: new Date(),
      });
    } else if (command.type === "set_session_name") {
      await updateAgentSessionMetadata(id, { name: command.name });
    }
    return Response.json({
      accepted: true,
      queuedMessages: result.snapshot?.queuedMessages,
      ...(command.type === "show_usage"
        ? { usage: result.commandResult }
        : {}),
    });
  } catch (error) {
    return Response.json(
      {
        error: connectionErrorMessage(
          error,
          isAgentProviderId(authorized.owned.connection.provider)
            ? authorized.owned.connection.provider
            : "pi",
        ),
      },
      { status: 400 },
    );
  }
}
