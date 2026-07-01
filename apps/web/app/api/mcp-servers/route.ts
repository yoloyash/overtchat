import { auth } from "@/lib/auth/server";
import {
  createMcpServer,
  listMcpServers,
  toAdminMcpServer,
} from "@/lib/db/tools";
import { McpServerSchema } from "@/lib/toolConfig";

async function requireAdmin(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { error: new Response("Unauthorized", { status: 401 }) };
  if (session.user.role !== "admin") {
    return { error: new Response("Forbidden", { status: 403 }) };
  }
  return { session };
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const rows = await listMcpServers();
  return Response.json({ servers: rows.map(toAdminMcpServer) });
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

  const row = await createMcpServer(parsed.data);
  return Response.json({ server: toAdminMcpServer(row) }, { status: 201 });
}
