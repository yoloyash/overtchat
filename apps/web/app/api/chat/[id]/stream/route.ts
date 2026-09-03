import { auth } from "@/lib/auth/server";
import { preflight, withCors } from "@/lib/cors";
import { getActiveStreamId, getChat } from "@/lib/db/chats";
import { failChatStream } from "@/lib/db/chatTurns";
import * as cancelRegistry from "@/lib/streams/cancel-registry";
import { resumeChatStreamResponse } from "@/lib/streams/http";

export const maxDuration = 300;

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return withCors(req, new Response("Unauthorized", { status: 401 }));

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) return withCors(req, new Response("Not found", { status: 404 }));

  const streamId = await getActiveStreamId(id);
  if (!streamId) return withCors(req, new Response(null, { status: 204 }));

  let response: Response | null;
  try {
    response = await resumeChatStreamResponse(req, streamId);
  } catch (error) {
    console.warn("[resumable-stream] failed to resume stream", error);
    if (!cancelRegistry.has(streamId)) {
      failChatStream({
        chatId: id,
        streamId,
        error: "Generation stream could not be resumed.",
      });
    }
    return withCors(req, new Response(null, { status: 204 }));
  }
  if (!response) {
    if (!cancelRegistry.has(streamId)) {
      failChatStream({
        chatId: id,
        streamId,
        error: "Generation stream was no longer available.",
      });
    }
    return withCors(req, new Response(null, { status: 204 }));
  }
  return response;
}
