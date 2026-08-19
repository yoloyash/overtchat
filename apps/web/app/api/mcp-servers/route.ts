import { auth } from "@/lib/auth/server";
import {
  createMcpServer,
  listMcpServers,
  toMcpServer,
} from "@/lib/db/mcpServers";
import { McpServerInputSchema } from "@/lib/mcp/schema";

async function requireAdmin(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const rows = await listMcpServers();
  return Response.json({ mcpServers: rows.map(toMcpServer) });
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = McpServerInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const row = await createMcpServer(parsed.data);
  return Response.json({ mcpServer: toMcpServer(row) }, { status: 201 });
}
