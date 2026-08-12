import { auth } from "@/lib/auth/server";
import {
  connectionErrorMessage,
  storedConnectionAccessError,
} from "@/lib/agents/access";
import { daemonSession } from "@/lib/agents/connector/descriptors";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import {
  type AgentRuntimeEnvelope,
  type AgentSessionSync,
} from "@overtchat/agent-bridge";
import {
  formatAgentRuntimeCursor,
  parseAgentRuntimeCursor,
} from "@/lib/agents/sessionReplica";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";
import { isAgentProviderId } from "@overtchat/agent-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeEvent(
  envelope: AgentRuntimeEnvelope,
  event: "runtime" | "legacy-runtime" = "runtime",
): Uint8Array {
  return new TextEncoder().encode(
    `id: ${envelope.epoch}:${envelope.sequence}\nevent: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`,
  );
}

function encodeSync(sync: AgentSessionSync): Uint8Array {
  return new TextEncoder().encode(
    `id: ${formatAgentRuntimeCursor(sync.cursor)}\nevent: sync\ndata: ${JSON.stringify(sync)}\n\n`,
  );
}

function runtimeEventsFromSync(sync: AgentSessionSync): AgentRuntimeEnvelope[] {
  if (!sync.reset) return sync.events;
  return [
    {
      epoch: sync.cursor.epoch,
      sequence: sync.cursor.sequence,
      type: "snapshot",
      data: sync.snapshot,
    },
  ];
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

  const pending: Array<
    | { type: "runtime"; envelope: AgentRuntimeEnvelope }
    | { type: "sync"; sync: AgentSessionSync }
  > = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let closeStream = () => {};
  let authoritative = false;
  let aborted = req.signal.aborted;
  const handleAbort = () => {
    aborted = true;
    if (controller) closeStream();
    else closed = true;
  };
  req.signal.addEventListener("abort", handleAbort, { once: true });
  try {
    const supportsSessionSync =
      new URL(req.url).searchParams.get("sync") === "1";
    const after =
      parseAgentRuntimeCursor(req.headers.get("last-event-id")) ??
      parseAgentRuntimeCursor(new URL(req.url).searchParams.get("after"));

    const encode = (
      item:
        | { type: "runtime"; envelope: AgentRuntimeEnvelope }
        | { type: "sync"; sync: AgentSessionSync },
    ): Uint8Array[] => {
      if (!supportsSessionSync) {
        return item.type === "runtime"
          ? [encodeEvent(item.envelope)]
          : runtimeEventsFromSync(item.sync).map((envelope) =>
              encodeEvent(envelope),
            );
      }
      if (item.type === "sync") return [encodeSync(item.sync)];
      return [
        encodeEvent(
          item.envelope,
          authoritative ? "runtime" : "legacy-runtime",
        ),
      ];
    };

    const enqueue = (
      item:
        | { type: "runtime"; envelope: AgentRuntimeEnvelope }
        | { type: "sync"; sync: AgentSessionSync },
    ) => {
      if (!controller) {
        pending.push(item);
        return;
      }
      try {
        for (const chunk of encode(item)) controller.enqueue(chunk);
      } catch {
        closeStream();
      }
    };

    const subscription = await hostConnectorBroker.subscribeSession(
      owned.host.connectorId,
      daemonSession(owned),
      after,
      (envelope) => {
        if (closed) return;
        enqueue({ type: "runtime", envelope });
      },
      (sync) => {
        if (closed) return;
        enqueue({ type: "sync", sync });
      },
      () => closeStream(),
    );
    if (aborted) {
      subscription.unsubscribe();
      req.signal.removeEventListener("abort", handleAbort);
      return new Response(null, { status: 204 });
    }
    authoritative = subscription.authoritative;

    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        if (subscription.sync) {
          for (const chunk of encode({ type: "sync", sync: subscription.sync })) {
            streamController.enqueue(chunk);
          }
        }
        for (const item of pending.splice(0)) {
          for (const chunk of encode(item)) streamController.enqueue(chunk);
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
          req.signal.removeEventListener("abort", handleAbort);
          subscription.unsubscribe();
          try {
            streamController.close();
          } catch {
            // The browser may already have closed the stream.
          }
        };
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
    req.signal.removeEventListener("abort", handleAbort);
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
