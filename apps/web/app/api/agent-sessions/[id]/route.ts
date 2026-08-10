import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { agentSessionCommandSchema } from "@/lib/agents/types";
import { agentRuntimeRegistry } from "@/lib/agents/runtime/registry";
import {
  getOwnedAgentSession,
  type OwnedAgentSession,
  updateAgentSessionMetadata,
} from "@/lib/db/agentConnections";
import { isAgentProviderId } from "@/lib/agents/catalog";

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
    const runtime = await agentRuntimeRegistry.getOrStart(authorized.owned);
    return Response.json({ snapshot: runtime.snapshot() });
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
    const runtime = await agentRuntimeRegistry.getOrStart(authorized.owned);
    const normalized = runtime.normalizeCommand(parsed.data);
    if (normalized.type === "new_session") {
      const created = await agentRuntimeRegistry.create(authorized.owned);
      return Response.json({
        accepted: true,
        sessionId: created.sessionId,
      });
    }
    if (
      normalized.type === "edit_message" ||
      normalized.type === "fork_message"
    ) {
      const created = await agentRuntimeRegistry.fork(
        authorized.owned,
        runtime,
        normalized,
      );
      return Response.json({ accepted: true, ...created });
    }
    const commandResult = await runtime.command(normalized);
    if (
      normalized.type === "prompt" ||
      normalized.type === "implement_plan" ||
      normalized.type === "steer" ||
      normalized.type === "steer_queued_message"
    ) {
      await updateAgentSessionMetadata(id, {
        ...(
          normalized.type === "prompt" &&
          !authorized.owned.agentSession.firstMessage
          ? {
              firstMessage:
                normalized.message ||
                normalized.images?.[0]?.filename ||
                "Image attachment",
            }
          : {}),
        providerModifiedAt: new Date(),
      });
    } else if (normalized.type === "set_session_name") {
      await updateAgentSessionMetadata(id, { name: normalized.name });
    }
    return Response.json({
      accepted: true,
      queuedMessages: runtime.snapshot().queuedMessages,
      ...(normalized.type === "show_usage"
        ? { usage: commandResult }
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
