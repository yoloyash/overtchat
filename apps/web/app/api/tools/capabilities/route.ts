import { auth } from "@/lib/auth/server";
import { preflight, withCors } from "@/lib/cors";
import { listEnabledMcpServers, getToolSettings } from "@/lib/db/tools";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return withCors(req, new Response("Unauthorized", { status: 401 }));

  const [settings, enabledMcpServers] = await Promise.all([
    getToolSettings(),
    listEnabledMcpServers(),
  ]);

  return withCors(
    req,
    Response.json({
      webSearchEnabled: settings.webSearchEnabled,
      mcpServersEnabled: enabledMcpServers.length > 0,
    }),
  );
}
