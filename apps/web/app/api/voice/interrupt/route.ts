import { auth } from "@/lib/auth/server";
import { getVoicePrincipal } from "@/lib/db/voiceSessions";
import { getChatGenerationByRequestId } from "@/lib/db/chatTurns";
import { getChat } from "@/lib/db/chats";
import { verifyVoiceTicket } from "@/lib/voice/ticket";
import { cancel } from "@/lib/streams/cancel-registry";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const ticket = verifyVoiceTicket(request.headers.get("x-overtchat-voice-ticket") ?? "");
  if (!ticket || ticket.userId !== session.user.id || !getVoicePrincipal(ticket.sessionId, ticket.chatId, ticket.userId)) {
    return new Response("Voice session expired", { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.clientRequestId !== "string" || !body.clientRequestId.startsWith(`voice:${ticket.sessionId}:`)) {
    return new Response("Invalid turn", { status: 400 });
  }
  const generation = await getChatGenerationByRequestId(ticket.userId, body.clientRequestId);
  const chat = await getChat(ticket.chatId, ticket.userId);
  // A delayed interruption must never cancel the next response.
  if (generation?.chatId === ticket.chatId && generation.status === "running" && chat?.activeStreamId === generation.id) {
    cancel(generation.id);
    if (body.waitForCompletion === true) {
      const deadline = Date.now() + 10_000;
      while ((await getChatGenerationByRequestId(ticket.userId, body.clientRequestId))?.status === "running") {
        if (request.signal.aborted || Date.now() >= deadline) {
          return Response.json({ error: "The previous response is still stopping. Please try again." }, { status: 409 });
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
  return new Response(null, { status: 204 });
}
