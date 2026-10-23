import { withShareUrl } from "@/lib/share-url";
import { auth } from "@/lib/auth/server";
import { listChatShares } from "@/lib/db/chatShares";
import { shareResponse } from "@/lib/sharing-response";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return shareResponse(() => ({
    shares: listChatShares(session.user.id).map(withShareUrl),
  }));
}
