import { auth } from "@/lib/auth/server";
import { verifyVoiceTicket } from "@/lib/voice/ticket";
import { endVoiceSession, getVoicePrincipal, renewVoiceSession } from "@/lib/db/voiceSessions";
import { subscribeVoiceEvents } from "@/lib/voice/events";

export const maxDuration = 3600;
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const ticket = verifyVoiceTicket(request.headers.get("x-overtchat-voice-ticket") ?? "");
  if (!ticket || ticket.userId !== session.user.id || !getVoicePrincipal(ticket.sessionId, ticket.chatId, ticket.userId)) {
    return new Response("Voice session expired", { status: 401 });
  }
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let stopped = false;
      let unsubscribe = () => {};
      let interval: ReturnType<typeof setInterval> | undefined = undefined;
      stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(interval);
        unsubscribe();
        request.signal.removeEventListener("abort", stop);
        endVoiceSession(ticket.sessionId, ticket.userId);
        try { controller.close(); } catch {}
      };
      try {
        unsubscribe = subscribeVoiceEvents(ticket.sessionId, (event) => {
          if ((controller.desiredSize ?? 0) < -32) return stop();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        });
      } catch { controller.error(new Error("Voice events already connected")); return; }
      controller.enqueue(encoder.encode(": connected\n\n"));
      interval = setInterval(() => {
        if (!getVoicePrincipal(ticket.sessionId, ticket.chatId, ticket.userId) || ticket.expiresAt * 1000 < Date.now()) return stop();
        renewVoiceSession(ticket.sessionId);
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 20_000);
      request.signal.addEventListener("abort", stop, { once: true });
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
