import { auth } from "@/lib/auth/server";
import { listAvailableMcpServers } from "@/lib/db/mcpServers";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const mcpServers = await listAvailableMcpServers(
    session.user.id,
    session.user.role,
  );
  return Response.json({ mcpServers });
}
