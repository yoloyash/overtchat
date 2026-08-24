import { auth } from "@/lib/auth/server";
import {
  deleteMcpServer,
  getMcpServer,
  toMcpServer,
  updateMcpServer,
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  if (!(await getMcpServer(id))) {
    return new Response("Not found", { status: 404 });
  }

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

  const row = await updateMcpServer(id, parsed.data);
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({ mcpServer: toMcpServer(row) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  if (!(await getMcpServer(id))) {
    return new Response("Not found", { status: 404 });
  }
  await deleteMcpServer(id);
  return new Response(null, { status: 204 });
}
