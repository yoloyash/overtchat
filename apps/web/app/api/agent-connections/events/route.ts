import { auth } from "@/lib/auth/server";
import { connectionAccessError } from "@/lib/agents/access";
import {
  hostConnectorBroker,
  type AgentSessionDirectoryEvent,
  type AgentWorkspaceGitEvent,
  type AgentWorkspaceGitWatchTarget,
} from "@/lib/agents/connector/broker";
import { daemonTarget } from "@/lib/agents/connector/descriptors";
import {
  getOwnedAgentWorkspace,
  listAgentConnections,
} from "@/lib/db/agentConnections";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_GIT_WORKSPACES = 64;

function encodeEvent(event: AgentSessionDirectoryEvent): Uint8Array {
  const data =
    event.type === "snapshot" ? { sessions: event.sessions } : event.session;
  return new TextEncoder().encode(
    `event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function encodeGitEvent(
  workspaceId: string,
  event: AgentWorkspaceGitEvent,
): Uint8Array {
  const data =
    event.type === "live"
      ? { workspaceId, live: event.live }
      : { workspaceId, status: event.status };
  return new TextEncoder().encode(`event: git\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Workspaces whose Git status the client is displaying (`?git=id,id`). */
async function gitWatchTargets(
  req: Request,
  userId: string,
): Promise<AgentWorkspaceGitWatchTarget[]> {
  const ids = [
    ...new Set(
      (new URL(req.url).searchParams.get("git") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_GIT_WORKSPACES);
  const owned = await Promise.all(
    ids.map((id) => getOwnedAgentWorkspace(id, userId)),
  );
  return owned.flatMap((workspace) =>
    workspace
      ? [
          {
            connectorId: workspace.host.connectorId,
            workspaceId: workspace.workspace.id,
            target: daemonTarget(workspace.host, workspace.connection.shellMode),
            path: workspace.workspace.path,
          },
        ]
      : [],
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
  const gitTargets = await gitWatchTargets(req, session.user.id);

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
      const stopDirectory = hostConnectorBroker.subscribeSessionDirectory(
        sessionIds,
        (event) => {
          if (closed) return;
          try {
            controller.enqueue(encodeEvent(event));
          } catch {
            finish();
          }
        },
      );
      const stopGit = gitTargets.map((target) =>
        hostConnectorBroker.watchWorkspaceGit(target, (event) => {
          if (closed) return;
          try {
            controller.enqueue(encodeGitEvent(target.workspaceId, event));
          } catch {
            finish();
          }
        }),
      );
      unsubscribe = () => {
        stopDirectory();
        for (const stop of stopGit) stop();
      };
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
