import { auth } from "@/lib/auth/server";
import { getChat, getMessages, getMessagesPage } from "@/lib/db/chats";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const requestedLimit = url.searchParams.get("limit");
  if (cursor !== undefined || requestedLimit !== null) {
    const limit = requestedLimit === null ? undefined : Number(requestedLimit);
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    ) {
      return new Response("Invalid limit", { status: 400 });
    }
    const cursorRowId = cursor === undefined ? undefined : Number(cursor);
    if (
      cursorRowId !== undefined &&
      (!Number.isSafeInteger(cursorRowId) || cursorRowId <= 0)
    ) {
      return new Response("Invalid cursor", { status: 400 });
    }
    const page = await getMessagesPage(id, { cursor, limit });
    return Response.json({ ...page, projectId: chat.projectId, kind: chat.kind, modelConfigId: chat.modelConfigId });
  }

  // Compatibility path for existing mobile clients. New clients should use
  // cursor pagination so opening a chat never transfers unbounded history.
  const messages = await getMessages(id);
  return Response.json({ messages, projectId: chat.projectId, kind: chat.kind, modelConfigId: chat.modelConfigId });
}
