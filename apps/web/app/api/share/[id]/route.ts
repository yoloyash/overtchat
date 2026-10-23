import { limitShareRead } from "@/lib/share-rate-limit";
import { readChatShare } from "@/lib/db/chatShares";
import { shareResponse } from "@/lib/sharing-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limited = limitShareRead(id, "page");
  if (limited) return limited;
  return shareResponse(() =>
    readChatShare(id, new URL(req.url).searchParams.get("cursor") ?? undefined),
  );
}
