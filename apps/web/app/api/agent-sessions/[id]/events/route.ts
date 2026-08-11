import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { daemonSession } from "@/lib/agents/connector/descriptors";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import type { AgentRuntimeEnvelope } from "@overtchat/agent-bridge";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";
import { isAgentProviderId } from "@overtchat/agent-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeEvent(envelope: AgentRuntimeEnvelope): Uint8Array {
  return new TextEncoder().encode(
    `id: ${envelope.epoch}:${envelope.sequence}\nevent: runtime\ndata: ${JSON.stringify(envelope)}\n\n`,
  );
}

function parseCursor(value: string | null):
  | { epoch: string; sequence: number }
  | undefined {
  if (!value) return undefined;
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return undefined;
  const epoch = value.slice(0, separator);
  const sequence = Number(value.slice(separator + 1));
  return Number.isSafeInteger(sequence) && sequence >= 0
    ? { epoch, sequence }
    : undefined;
}

export async function GET(
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
  const owned = await getOwnedAgentSession(id, session.user.id);
  if (!owned) return new Response("Not found", { status: 404 });

  const pending: AgentRuntimeEnvelope[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let closeStream = () => {};
  try {
    const unsubscribe = await hostConnectorBroker.subscribeSession(
      owned.host.connectorId,
      daemonSession(owned),
      parseCursor(req.headers.get("last-event-id")),
      (envelope) => {
        if (closed) return;
        if (!controller) {
          pending.push(envelope);
          return;
        }
        try {
          controller.enqueue(encodeEvent(envelope));
        } catch {
          closeStream();
        }
      },
      () => closeStream(),
    );

    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        for (const envelope of pending.splice(0)) {
          streamController.enqueue(encodeEvent(envelope));
        }
        const keepAlive = setInterval(() => {
          if (closed) return;
          try {
            streamController.enqueue(
              new TextEncoder().encode(": keepalive\n\n"),
            );
          } catch {
            closeStream();
          }
        }, 15_000);
        closeStream = () => {
          if (closed) return;
          closed = true;
          clearInterval(keepAlive);
          unsubscribe();
          try {
            streamController.close();
          } catch {
            // The browser may already have closed the stream.
          }
        };
        req.signal.addEventListener("abort", closeStream, { once: true });
      },
      cancel() {
        closeStream();
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
    closed = true;
    return Response.json(
      {
        error: connectionErrorMessage(
          error,
          isAgentProviderId(owned.connection.provider)
            ? owned.connection.provider
            : "pi",
        ),
      },
      { status: 400 },
    );
  }
}
