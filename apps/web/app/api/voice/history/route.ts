import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { getChat } from "@/lib/db/chats";
import { getModelConfig, modelConfigForUser } from "@/lib/db/modelConfigs";
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

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  // Its own header, since bundled clients send their session as `Authorization`.
  const token = request.headers.get("x-overtchat-voice-ticket")?.trim();
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
    modelConfigId: ticket.modelConfigId,
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

  const storedModel = await getModelConfig(ticket.modelConfigId);
  // Titles fall back to the chat's own model: on this user's credential if per-user.
  const selectedModel = storedModel && modelConfigForUser(storedModel, ticket.userId);
  await ensureChatTitle({
    chatId: ticket.chatId,
    userId: ticket.userId,
    fallbackModelConfig: selectedModel?.modelType === "image" ? null : selectedModel,
  });
  const chat = await getChat(ticket.chatId, ticket.userId);
  return Response.json({
    chat: chat
      ? {
          id: chat.id,
          title: chat.title,
          pinned: chat.pinned,
          kind: chat.kind,
          projectId: chat.projectId,
          updatedAt: chat.updatedAt.getTime(),
        }
      : null,
    changed: result.changed,
  });
}
