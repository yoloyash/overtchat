import { auth } from "@/lib/auth/server";
import { searchChats } from "@/lib/db/search";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const hits = await searchChats(session.user.id, q);
  return Response.json({ hits });
}
