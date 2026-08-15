import type { AgentRuntimeStatus } from "@overtchat/agent-bridge";
import { auth } from "@/lib/auth/server";
import { connectionAccessError } from "@/lib/agents/access";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { listAgentConnections } from "@/lib/db/agentConnections";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeStatus(
  sessionId: string,
  runtimeStatus: AgentRuntimeStatus,
): Uint8Array {
  return new TextEncoder().encode(
    `event: status\ndata: ${JSON.stringify({ sessionId, runtimeStatus })}\n\n`,
  );
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  const connections = await listAgentConnections(session.user.id);
  const sessionIds = connections.flatMap((connection) =>
    connection.workspaces.flatMap((workspace) =>
      workspace.sessions.map((agentSession) => agentSession.id),
    ),
  );

  let close = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        req.signal.removeEventListener("abort", finish);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };
      close = finish;
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
        } catch {
          finish();
        }
      }, 15_000);
      const stopStatuses = hostConnectorBroker.subscribeSessionStatuses(
        sessionIds,
        (sessionId, runtimeStatus) => {
          if (closed) return;
          try {
            controller.enqueue(encodeStatus(sessionId, runtimeStatus));
          } catch {
            finish();
          }
        },
      );
      unsubscribe = stopStatuses;
      if (closed) unsubscribe();
      req.signal.addEventListener("abort", finish, { once: true });
      if (req.signal.aborted) finish();
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
}
