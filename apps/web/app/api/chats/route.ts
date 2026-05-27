import { auth } from "@/lib/auth/server";
import { preflight, withCors } from "@/lib/cors";
import { listChats } from "@/lib/db/chats";
import type { ChatListItem } from "@/lib/queries/chats";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return withCors(req, new Response("Unauthorized", { status: 401 }));

  const rows = await listChats(session.user.id);
  const items: ChatListItem[] = rows.map((c) => ({
    id: c.id,
    title: c.title,
    projectId: c.projectId,
    updatedAt: c.updatedAt.getTime(),
  }));
  return withCors(req, Response.json({ chats: items }));
}
