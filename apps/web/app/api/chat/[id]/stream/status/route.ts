import type { ChatGenerationState } from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { getChat } from "@/lib/db/chats";
import {
  getChatMessage,
  getChatGeneration,
  getLatestChatGeneration,
} from "@/lib/db/chatTurns";
import { withGmailEmailState } from "@/lib/integrations/gmail-emails";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) {
    return new Response("Not found", { status: 404 });
  }

  const active = chat.activeStreamId !== null;
  const generation = chat.activeStreamId
    ? await getChatGeneration(chat.activeStreamId, session.user.id)
    : await getLatestChatGeneration(id, session.user.id);
  const stored = generation?.responseMessageId
    ? await getChatMessage(id, generation.responseMessageId)
    : null;
  // A client puts this in place of the message it loaded, so it carries the
  // same marks: which emails the user has saved in Gmail or sent.
  const responseMessage = stored
    ? withGmailEmailState(session.user.id, [stored])[0]
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
  return response;
}
