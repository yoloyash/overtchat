import { auth } from "@/lib/auth/server";
import { listIntegrations } from "@/lib/db/integrations";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return Response.json({ integrations: listIntegrations(session.user.id) });
}
