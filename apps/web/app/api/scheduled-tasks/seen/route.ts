import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { markScheduledRunsSeen } from "@/lib/db/scheduledTasks";

const input = z.object({ chatId: z.string().trim().min(1).max(200) });

/** The owner opened a chat a run wrote: it is no longer new. */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }
  markScheduledRunsSeen(session.user.id, parsed.data.chatId);
  return new Response(null, { status: 204 });
}
