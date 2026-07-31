import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import {
  agentRuntimeRegistry,
} from "@/lib/agents/runtime/registry";
import type { AgentRuntimeEnvelope } from "@/lib/agents/types";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeEvent(envelope: AgentRuntimeEnvelope): Uint8Array {
  return new TextEncoder().encode(
    `id: ${envelope.sequence}\nevent: runtime\ndata: ${JSON.stringify(envelope)}\n\n`,
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const owned = await getOwnedAgentSession(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  const accessError = storedConnectionAccessError(
    session.user.role,
    owned.host,
  );
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  try {
    const runtime = await agentRuntimeRegistry.getOrStart(owned);
    const lastEventId = Number(req.headers.get("last-event-id") ?? "0");
    let close = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let unsubscribe = () => {};
        const finish = () => {
          if (closed) return;
          closed = true;
          clearInterval(keepAlive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // The browser may already have closed its side of the stream.
          }
        };
        const keepAlive = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
            } catch {
              finish();
            }
          }
        }, 15_000);
        unsubscribe = runtime.subscribe((envelope) => {
          if (closed) return;
          try {
            controller.enqueue(encodeEvent(envelope));
          } catch {
            finish();
          }
        }, Number.isFinite(lastEventId) ? lastEventId : 0);
        req.signal.addEventListener("abort", finish, { once: true });
        close = finish;
      },
      cancel() {
        close();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
