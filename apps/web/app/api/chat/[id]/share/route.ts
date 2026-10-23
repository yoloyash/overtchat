import { withShareUrl } from "@/lib/share-url";
import { auth } from "@/lib/auth/server";
import { getChat } from "@/lib/db/chats";
import {
  getChatShare,
  publishChatShare,
  revokeChatShare,
} from "@/lib/db/chatShares";
import { shareResponse } from "@/lib/sharing-response";

type Context = { params: Promise<{ id: string }> };

async function handle(req: Request, context: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await context.params;
  const userId = session.user.id;
  if (!(await getChat(id, userId)))
    return new Response("Not found", { status: 404 });
  return shareResponse(() => {
    if (req.method === "GET")
      return { share: withShareUrl(getChatShare(id, userId)) };
    if (req.method === "DELETE") {
      revokeChatShare(id, userId);
      return { share: null };
    }
    const share = publishChatShare(id, userId, req.method === "PUT");
    return share ? { share: withShareUrl(share) } : null;
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
