import type { ChatGenerationState } from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { preflight, withCors } from "@/lib/cors";
import { getChat } from "@/lib/db/chats";
import {
  getChatMessage,
  getChatGeneration,
  getLatestChatGeneration,
} from "@/lib/db/chatTurns";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return withCors(req, new Response("Unauthorized", { status: 401 }));
  }

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) {
    return withCors(req, new Response("Not found", { status: 404 }));
  }

  const active = chat.activeStreamId !== null;
  const generation = chat.activeStreamId
    ? await getChatGeneration(chat.activeStreamId, session.user.id)
    : await getLatestChatGeneration(id, session.user.id);
  const responseMessage = generation?.responseMessageId
    ? await getChatMessage(id, generation.responseMessageId)
    : null;
  const body: ChatGenerationState = {
    active,
    streamId: chat.activeStreamId ?? generation?.id ?? null,
    status: active ? "running" : (generation?.status ?? "idle"),
    startedAt: generation?.startedAt.getTime() ?? null,
    completedAt: generation?.completedAt?.getTime() ?? null,
    ...(responseMessage ? { responseMessage } : {}),
  };

  const response = Response.json(body);
  response.headers.set("Cache-Control", "no-store");
  return withCors(req, response);
}
