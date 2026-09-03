import "server-only";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { corsHeaders } from "@/lib/cors";
import { getStreamContext } from "@/lib/streams/context";

/** Attach an HTTP consumer to an existing generation without starting work. */
export async function resumeChatStreamResponse(
  req: Request,
  streamId: string,
): Promise<Response | null> {
  const streamContext = getStreamContext();
  if (!streamContext) return null;

  const stream = await streamContext.resumeExistingStream(streamId);
  if (!stream) return null;

  const headers = corsHeaders(req);
  for (const [key, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Encoding", "none");
  headers.set("X-OvertChat-Stream-Id", streamId);
  return new Response(stream, { headers });
}
