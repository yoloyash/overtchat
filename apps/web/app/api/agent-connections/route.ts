import { auth } from "@/lib/auth/server";
import {
  connectionAccessError,
  connectionErrorMessage,
} from "@/lib/agents/access";
import {
  agentConnectionDraftSchema,
  type AgentConnectionListItem,
} from "@/lib/agents/types";
import { encryptAgentCredential } from "@/lib/agents/runtime/credentials";
import { probePiConnection } from "@/lib/agents/pi/probe";
import {
  createAgentConnection,
  listAgentConnections,
} from "@/lib/db/agentConnections";

export const maxDuration = 150;

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return Response.json({
    connections: await listAgentConnections(session.user.id),
  });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const parsed = agentConnectionDraftSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid connection." },
      { status: 400 },
    );
  }
  const draft = parsed.data;
  const accessError = connectionAccessError(session.user.role, draft);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  if (draft.transport === "ssh" && !draft.hostKey?.trim()) {
    return Response.json(
      { error: "Test and confirm the SSH host key before connecting." },
      { status: 400 },
    );
  }

  try {
    const probe = await probePiConnection(draft);
    if (probe.status !== "ready") {
      return Response.json(
        { error: "Test and confirm the SSH host key before connecting." },
        { status: 400 },
      );
    }
    const owned = createAgentConnection({
      userId: session.user.id,
      host:
        draft.transport === "local"
          ? {
              name: draft.name,
              transport: "local",
            }
          : {
              name: draft.name,
              transport: "ssh",
              hostname: draft.hostname,
              port: draft.port,
              username: draft.username,
              sshAuth: draft.sshAuth,
              encryptedCredential:
                draft.sshAuth === "private_key" && draft.privateKey
                  ? encryptAgentCredential(draft.privateKey)
                  : null,
              hostKey: draft.hostKey,
            },
      connection: {
        provider: draft.provider,
        executable: draft.executable,
        detectedVersion: probe.version,
      },
    });
    const connections = await listAgentConnections(session.user.id);
    const connection = connections.find(
      (candidate) => candidate.id === owned.connection.id,
    ) as AgentConnectionListItem | undefined;
    if (!connection) throw new Error("The saved connection could not be read.");
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}
