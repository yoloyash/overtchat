import { auth } from "@/lib/auth/server";
import { preflight, withCors } from "@/lib/cors";
import { getActiveStreamId, getChat } from "@/lib/db/chats";
import * as cancelRegistry from "@/lib/streams/cancel-registry";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return withCors(req, new Response("Unauthorized", { status: 401 }));

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) return withCors(req, new Response("Not found", { status: 404 }));

  const streamId = await getActiveStreamId(id);
  if (streamId) cancelRegistry.cancel(streamId);

  return withCors(req, new Response(null, { status: 204 }));
}
