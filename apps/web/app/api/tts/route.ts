import { auth } from "@/lib/auth/server";
import { proxySpeech } from "@/lib/speech/proxy";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  return proxySpeech(req, "mp3");
}
