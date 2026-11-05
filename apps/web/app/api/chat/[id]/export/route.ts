import { auth } from "@/lib/auth/server";
import { exportChat } from "@/lib/export";
import { chatToMarkdown, exportTimeZone } from "@/lib/export/markdown";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "markdown") {
    return new Response("Invalid format", { status: 400 });
  }

  const { id } = await params;
  const payload = await exportChat(id, session.user.id);
  if (!payload) return new Response("Not found", { status: 404 });

  const slug =
    (payload.chats[0]?.title ?? id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || id;

  if (format === "markdown") {
    const markdown = chatToMarkdown(payload.chats[0], {
      // The server cannot know the reader's zone, so the link carries it.
      timeZone: exportTimeZone(url.searchParams.get("timeZone")),
      exportedAt: payload.exportedAt,
    });
    return new Response(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}.md"`,
      },
    });
  }

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${slug}.json"`,
    },
  });
}
