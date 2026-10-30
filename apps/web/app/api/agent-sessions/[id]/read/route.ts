import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { storedConnectionAccessError } from "@/lib/agents/access";
import {
  getOwnedAgentSession,
  markAgentSessionRead,
  markAgentSessionUnread,
} from "@/lib/db/agentConnections";

const readStateSchema = z.strictObject({ read: z.boolean() });

/** Marks the session's latest finished turn as read or unread. */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = storedConnectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const parsed = readStateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid read state." }, { status: 400 });
  }
  const { id } = await params;
  if (!(await getOwnedAgentSession(id, session.user.id))) {
    return new Response("Not found", { status: 404 });
  }
  if (parsed.data.read) {
    markAgentSessionRead(id);
  } else if (!markAgentSessionUnread(id)) {
    return Response.json(
      { error: "This session has no finished turn to mark unread." },
      { status: 409 },
    );
  }
  return new Response(null, { status: 204 });
}
