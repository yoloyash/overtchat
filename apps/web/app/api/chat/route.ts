import { auth } from "@/lib/auth/server";
import { parseChatRequest } from "@/lib/chat/request";
import { chatErrorResponse, runChat } from "@/lib/chat/run";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return new Response("Unauthorized", { status: 401 });
    return await runChat(req, session.user, await parseChatRequest(req));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
