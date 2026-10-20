import { auth } from "@/lib/auth/server";
import { getActiveStreamId, getChat } from "@/lib/db/chats";
import { failChatStream } from "@/lib/db/chatTurns";
import * as cancelRegistry from "@/lib/streams/cancel-registry";
import { resumeChatStreamResponse } from "@/lib/streams/http";

export const maxDuration = 300;

export async function GET(
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
  if (!streamId) return new Response(null, { status: 204 });

  let response: Response | null;
  try {
    response = await resumeChatStreamResponse(streamId);
  } catch (error) {
    console.warn("[resumable-stream] failed to resume stream", error);
    if (!cancelRegistry.has(streamId)) {
      failChatStream({
        chatId: id,
        streamId,
        error: "Generation stream could not be resumed.",
      });
    }
    return new Response(null, { status: 204 });
  }
  if (!response) {
    if (!cancelRegistry.has(streamId)) {
      failChatStream({
        chatId: id,
        streamId,
        error: "Generation stream was no longer available.",
      });
    }
    return new Response(null, { status: 204 });
  }
  return response;
}
