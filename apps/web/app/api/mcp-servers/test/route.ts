import { auth } from "@/lib/auth/server";
import { testMcpServer } from "@/lib/mcp";
import { McpServerSchema } from "@/lib/toolConfig";

async function requireAdmin(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { error: new Response("Unauthorized", { status: 401 }) };
  if (session.user.role !== "admin") {
    return { error: new Response("Forbidden", { status: 403 }) };
  }
  return { session };
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const parsed = McpServerSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const result = await testMcpServer({
    name: parsed.data.name,
    slug: "draft",
    command: parsed.data.command,
    args: parsed.data.args,
    env: parsed.data.env,
    cwd: parsed.data.cwd,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
