import { auth } from "@/lib/auth/server";
import { exportAllChats } from "@/lib/export";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const payload = await exportAllChats(session.user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="overtchat-export-${stamp}.json"`,
    },
  });
}
