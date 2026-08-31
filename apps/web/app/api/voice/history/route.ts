import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { getChat } from "@/lib/db/chats";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { syncVoiceHistory } from "@/lib/db/voiceChats";
import { ensureChatTitle } from "@/lib/title";
import { voiceHistoryToUiMessages } from "@/lib/voice/history";
import { verifyVoiceTicket } from "@/lib/voice/ticket";

const baseItem = z.object({
  id: z.string().min(1).max(300),
  previousId: z.string().max(300).nullable(),
  status: z.enum(["completed", "incomplete"]),
});

const historyItem = z.discriminatedUnion("type", [
  baseItem.extend({
    type: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(100_000),
  }),
  baseItem.extend({
    type: z.literal("tool"),
    name: z.string().min(1).max(200),
    input: z.unknown(),
    output: z.unknown(),
  }),
]);

const inputSchema = z.object({
  items: z.array(historyItem).min(1).max(256),
});

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim() || null
    : null;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const token = bearerToken(request);
  const ticket = token ? verifyVoiceTicket(token) : null;
  if (!ticket || ticket.userId !== session.user.id) {
    return new Response("Voice session expired or invalid", { status: 401 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid voice history." }, { status: 400 });
  }

  const history = voiceHistoryToUiMessages(ticket.chatId, parsed.data.items);
  const result = syncVoiceHistory({
    chatId: ticket.chatId,
    userId: ticket.userId,
    projectId: ticket.projectId,
    allowCreate: ticket.newChat,
    history,
  });
  if (result.status !== "ok") {
    if (result.status === "wrong-kind") {
      return new Response("Voice cannot be added to a text chat", { status: 409 });
    }
    return new Response(
      result.status === "invalid-project" ? "Project not found" : "Chat not found",
      { status: 404 },
    );
  }

  const selectedModel = await getModelConfig(ticket.modelConfigId);
  await ensureChatTitle({
    chatId: ticket.chatId,
    userId: ticket.userId,
    fallbackModelConfig: selectedModel,
  });
  const chat = await getChat(ticket.chatId, ticket.userId);
  return Response.json({
    chat: chat
      ? {
          id: chat.id,
          title: chat.title,
          kind: chat.kind,
          projectId: chat.projectId,
          updatedAt: chat.updatedAt.getTime(),
        }
      : null,
    changed: result.changed,
  });
}
