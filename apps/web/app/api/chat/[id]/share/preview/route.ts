import { auth } from "@/lib/auth/server";
import { previewChatShare } from "@/lib/db/chatShares";
import { shareResponse } from "@/lib/sharing-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  return shareResponse(() => previewChatShare(id, session.user.id));
}
