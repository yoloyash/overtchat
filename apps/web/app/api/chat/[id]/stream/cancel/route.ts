import { auth } from "@/lib/auth/server";
import { getActiveStreamId, getChat } from "@/lib/db/chats";
import { completeChatStream } from "@/lib/db/chatTurns";
import * as cancelRegistry from "@/lib/streams/cancel-registry";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) return new Response("Not found", { status: 404 });

  const streamId = await getActiveStreamId(id);
  if (streamId && !cancelRegistry.cancel(streamId)) {
    completeChatStream({ chatId: id, streamId, status: "aborted" });
  }

  return new Response(null, { status: 204 });
}
