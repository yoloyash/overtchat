import { readChatShare } from "@/lib/db/chatShares";
import { shareResponse } from "@/lib/sharing-response";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return shareResponse(() => readChatShare(id));
}
