import { auth } from "@/lib/auth/server";
import { preflight, withCors } from "@/lib/cors";
import { getChat, getMessages } from "@/lib/db/chats";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return withCors(req, new Response("Unauthorized", { status: 401 }));

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) return withCors(req, new Response("Not found", { status: 404 }));

  const messages = await getMessages(id);
  return withCors(
    req,
    Response.json({ messages, projectId: chat.projectId }),
  );
}
