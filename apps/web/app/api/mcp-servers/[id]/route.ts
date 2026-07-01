import { auth } from "@/lib/auth/server";
import {
  deleteMcpServer,
  getMcpServer,
  toAdminMcpServer,
  updateMcpServer,
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const existing = await getMcpServer(id);
  if (!existing) return new Response("Not found", { status: 404 });

  const parsed = McpServerSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const row = await updateMcpServer(id, parsed.data);
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({ server: toAdminMcpServer(row) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const { id } = await params;
  await deleteMcpServer(id);
  return new Response(null, { status: 204 });
}
