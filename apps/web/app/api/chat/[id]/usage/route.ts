import { auth } from "@/lib/auth/server";
import { getChat } from "@/lib/db/chats";
import { getChatUsageTotals } from "@/lib/db/usage";
import type { ChatUsageResponse } from "@/lib/usage/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const chat = await getChat(id, session.user.id);
  if (!chat) return new Response("Not found", { status: 404 });

  const body: ChatUsageResponse = {
    usage: await getChatUsageTotals(id, session.user.id),
  };
  return Response.json(body);
}
