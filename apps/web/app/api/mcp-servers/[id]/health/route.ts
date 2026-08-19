import { auth } from "@/lib/auth/server";
import { getMcpServer } from "@/lib/db/mcpServers";
import { checkMcpServerHealth } from "@/lib/mcp/health";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const server = await getMcpServer(id);
  if (!server) return new Response("Not found", { status: 404 });

  return Response.json(await checkMcpServerHealth(server));
}
