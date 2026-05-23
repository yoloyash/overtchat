import { auth } from "@/lib/auth/server";
import { exportChat } from "@/lib/export";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const payload = await exportChat(id, session.user.id);
  if (!payload) return new Response("Not found", { status: 404 });

  const slug =
    (payload.chats[0]?.title ?? id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || id;

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${slug}.json"`,
    },
  });
}
