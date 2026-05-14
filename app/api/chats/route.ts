import { auth } from "@/lib/auth/server";
import { listChats } from "@/lib/db/chats";
import type { ChatListItem } from "@/lib/queries/chats";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const rows = await listChats(session.user.id);
  const items: ChatListItem[] = rows.map((c) => ({
    id: c.id,
    title: c.title,
    projectId: c.projectId,
    updatedAt: c.updatedAt.getTime(),
  }));
  return Response.json({ chats: items });
}
