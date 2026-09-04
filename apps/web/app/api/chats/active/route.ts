import { auth } from "@/lib/auth/server";
import { preflight, withCors } from "@/lib/cors";
import { listActiveChatIds } from "@/lib/db/chats";
import type { ActiveChatIdsResponse } from "@/lib/queries/chats";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return withCors(req, new Response("Unauthorized", { status: 401 }));
  }

  const body: ActiveChatIdsResponse = {
    activeChatIds: await listActiveChatIds(session.user.id),
  };
  const response = Response.json(body);
  response.headers.set("Cache-Control", "no-store");
  return withCors(req, response);
}
