import { readUIMessageStream } from "ai";
import { z } from "zod";
import { runChat, chatErrorResponse } from "@/lib/chat/run";
import { verifyVoiceTicket } from "@/lib/voice/ticket";
import { authorizeVoiceService } from "@/lib/voice/internal-auth";
import { getVoicePrincipal } from "@/lib/db/voiceSessions";
import { publishVoiceEvent } from "@/lib/voice/events";
import { SpeechTextFilter } from "@/lib/voice/speech-text";

export const maxDuration = 300;
const input = z.object({
  model: z.string(),
  overtchat_turn_id: z.string().min(1).max(200),
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })).min(1),
});

export async function POST(request: Request) {
  if (!authorizeVoiceService(request)) return new Response("Unauthorized", { status: 401 });
  const body = await request.json().catch(() => null);
  // The pinned engine probes the bridge during pool warmup without a session.
  if (body?.model === "overtchat") return Response.json({
    id: "warmup", object: "chat.completion", created: 0, model: "overtchat",
    choices: [{ index: 0, message: { role: "assistant", content: "Ready." }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
  const parsed = input.safeParse(body);
  if (!parsed.success) return new Response("Invalid voice turn", { status: 400 });
  const ticket = verifyVoiceTicket(parsed.data.model);
  const principal = ticket && getVoicePrincipal(ticket.sessionId, ticket.chatId, ticket.userId);
  if (!ticket || !principal) return new Response("Voice session expired or invalid", { status: 401 });
  // Never replay engine-owned history, instructions or tools. The normal chat
  // service reconstructs the complete canonical conversation from SQLite.
  const last = parsed.data.messages.at(-1);
  const text = typeof last?.content === "string" ? last.content : Array.isArray(last?.content)
    ? last.content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n") : "";
  if (last?.role !== "user" || !text.trim() || text.length > 100_000) return new Response("Invalid voice input", { status: 400 });
  const turnId = `voice:${ticket.sessionId}:${parsed.data.overtchat_turn_id}`;
  const expired = new AbortController();
  const interval = setInterval(() => {
    if (!getVoicePrincipal(ticket.sessionId, ticket.chatId, ticket.userId) || ticket.expiresAt * 1000 < Date.now()) expired.abort();
  }, 1000);
  const turnRequest = new Request(request.url, { signal: AbortSignal.any([request.signal, expired.signal]) });
  try {
    const response = await runChat(turnRequest, principal, {
      messages: [{ id: turnId, role: "user", parts: [{ type: "text", text }] }],
      modelConfigId: ticket.modelConfigId, chatId: ticket.chatId, projectId: ticket.projectId,
      clientRequestId: turnId, webSearchEnabled: ticket.webSearchEnabled, forceSearch: false,
      timeZone: ticket.timeZone, reasoningLevel: ticket.reasoningLevel ?? "default",
      action: { type: "submit" }, temporary: false, responseStyle: "voice",
    }, {
      voiceSessionId: ticket.sessionId,
      onUserMessage(message) { publishVoiceEvent(ticket.sessionId, { type: "message", message }); },
      async respond(uiStream) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let disconnected = false;
            const enqueue = (value: string) => {
              if (disconnected) return;
              try { controller.enqueue(encoder.encode(value)); } catch { disconnected = true; expired.abort(); }
            };
            const chunk = (delta: Record<string, unknown>, finish: string | null = null) => enqueue(`data: ${JSON.stringify({
              id: turnId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "overtchat",
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`);
            let forwardedText = "";
            const speechText = new SpeechTextFilter();
            let lastPublished = 0;
            let latest: import("ai").UIMessage | undefined;
            let publishTimer: ReturnType<typeof setTimeout> | undefined;
            const flushMessage = () => {
              clearTimeout(publishTimer);
              publishTimer = undefined;
              if (latest) publishVoiceEvent(ticket.sessionId, { type: "message", message: latest });
              lastPublished = Date.now();
            };
            try {
              chunk({ role: "assistant" });
              for await (const message of readUIMessageStream({ stream: uiStream, terminateOnError: true })) {
                latest = message;
                if (Date.now() - lastPublished >= 40) flushMessage();
                else publishTimer ??= setTimeout(flushMessage, 40 - (Date.now() - lastPublished));
                const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
                if (text.startsWith(forwardedText) && text.length > forwardedText.length) {
                  const content = speechText.push(text.slice(forwardedText.length));
                  if (content) chunk({ content });
                }
                forwardedText = text;
              }
              flushMessage();
              const tail = speechText.finish();
              if (tail) chunk({ content: tail });
              chunk({}, "stop");
              enqueue("data: [DONE]\n\n");
            } catch {
              publishVoiceEvent(ticket.sessionId, { type: "error", message: "The voice response failed. Please try again." });
              enqueue(`data: ${JSON.stringify({ error: { message: "Voice generation failed." } })}\n\n`);
            } finally {
              clearInterval(interval);
              clearTimeout(publishTimer);
              publishVoiceEvent(ticket.sessionId, { type: "settled" });
              try { controller.close(); } catch {}
            }
          },
          cancel() { expired.abort(); },
        });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
      },
    });
    if (!response.headers.get("content-type")?.includes("text/event-stream")) clearInterval(interval);
    return response;
  } catch (error) {
    clearInterval(interval);
    return chatErrorResponse(error);
  }
}
