import { auth } from "@/lib/auth/server";
import { setMcpServerPreference } from "@/lib/db/mcpServers";
import { McpServerPreferenceInputSchema } from "@/lib/mcp/schema";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = McpServerPreferenceInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const mcpServer = await setMcpServerPreference(
    session.user.id,
    session.user.role,
    id,
    parsed.data.enabled,
  );
  if (!mcpServer) return new Response("Not found", { status: 404 });
  return Response.json({ mcpServer });
}
