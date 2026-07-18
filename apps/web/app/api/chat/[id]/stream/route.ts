import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { auth } from "@/lib/auth/server";
import { corsHeaders, preflight, withCors } from "@/lib/cors";
import { getActiveStreamId, getChat } from "@/lib/db/chats";
import { clearActiveStreamId } from "@/lib/db/chatTurns";
import * as cancelRegistry from "@/lib/streams/cancel-registry";
import { getStreamContext } from "@/lib/streams/context";

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

  const streamContext = getStreamContext();
  if (!streamContext) {
    if (!cancelRegistry.has(streamId)) {
      await clearActiveStreamId(id, streamId);
    }
    return withCors(req, new Response(null, { status: 204 }));
  }

  let replay: Awaited<ReturnType<typeof streamContext.resumeExistingStream>>;
  try {
    replay = await streamContext.resumeExistingStream(streamId);
  } catch (err) {
    console.warn("[resumable-stream] failed to resume stream", err);
    if (!cancelRegistry.has(streamId)) {
      await clearActiveStreamId(id, streamId);
    }
    return withCors(req, new Response(null, { status: 204 }));
  }
  if (!replay) {
    if (!cancelRegistry.has(streamId)) {
      await clearActiveStreamId(id, streamId);
    }
    return withCors(req, new Response(null, { status: 204 }));
  }

  const headers = corsHeaders(req);
  for (const [k, v] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
    headers.set(k, v);
  }
  headers.set("Content-Encoding", "none");

  return new Response(replay, { headers });
}
