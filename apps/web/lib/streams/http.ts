import "server-only";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { getStreamContext } from "@/lib/streams/context";

/** Attach an HTTP consumer to an existing generation without starting work. */
export async function resumeChatStreamResponse(
  streamId: string,
): Promise<Response | null> {
  const streamContext = getStreamContext();
  if (!streamContext) return null;

  const stream = await streamContext.resumeExistingStream(streamId);
  if (!stream) return null;

  const headers = new Headers();
  for (const [key, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Encoding", "none");
  headers.set("X-OvertChat-Stream-Id", streamId);
  return new Response(stream, { headers });
}
