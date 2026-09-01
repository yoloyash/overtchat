import { auth } from "@/lib/auth/server";
import { storedConnectionAccessError } from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { daemonSession } from "@/lib/agents/connector/descriptors";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";
import {
  isAgentTerminalSize,
  type AgentTerminalEvent,
  type AgentTerminalSnapshot,
} from "@overtchat/agent-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StreamItem =
  | { type: "snapshot"; snapshot: AgentTerminalSnapshot }
  | { type: "event"; event: AgentTerminalEvent };

function encode(item: StreamItem): Uint8Array {
  const revision =
    item.type === "snapshot" ? item.snapshot.revision : item.event.revision;
  const eventName =
    item.type === "snapshot"
      ? "terminal-snapshot"
      : `terminal-${item.event.type}`;
  const data = item.type === "snapshot" ? item.snapshot : item.event;
  return new TextEncoder().encode(
    `id: ${revision}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authSession = await auth.api.getSession({ headers: req.headers });
  if (!authSession) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(authSession.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const { id } = await params;
  const owned = await getOwnedAgentSession(id, authSession.user.id);
  if (!owned) return new Response("Not found", { status: 404 });
  if (
    hostConnectorBroker.isOnline(owned.host.connectorId) &&
    !hostConnectorBroker.supports(
      owned.host.connectorId,
      "workspace-terminal-v1",
    )
  ) {
    return Response.json(
      {
        error:
          "Update the OvertChat Host Connector to use workspace terminals.",
      },
      { status: 426 },
    );
  }

  const url = new URL(req.url);
  const size = {
    cols: Number(url.searchParams.get("cols") ?? 80),
    rows: Number(url.searchParams.get("rows") ?? 24),
  };
  if (!isAgentTerminalSize(size)) {
    return Response.json({ error: "Invalid terminal size." }, { status: 400 });
  }

  const pending: StreamItem[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let closeRequested = req.signal.aborted;
  let closeStream = () => {
    closeRequested = true;
  };
  const handleAbort = () => closeStream();
  req.signal.addEventListener("abort", handleAbort, { once: true });

  try {
    const enqueue = (item: StreamItem) => {
      if (closed) return;
      if (!controller) {
        pending.push(item);
        return;
      }
      try {
        controller.enqueue(encode(item));
      } catch {
        closeStream();
      }
    };
    const subscription = await hostConnectorBroker.subscribeTerminal(
      owned.host.connectorId,
      daemonSession(owned),
      size,
      (event) => enqueue({ type: "event", event }),
      () => closeStream(),
    );
    if (closeRequested) {
      subscription.unsubscribe();
      req.signal.removeEventListener("abort", handleAbort);
      return new Response(null, { status: 503 });
    }

    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        streamController.enqueue(
          encode({ type: "snapshot", snapshot: subscription.snapshot }),
        );
        for (const item of pending.splice(0)) {
          streamController.enqueue(encode(item));
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
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
