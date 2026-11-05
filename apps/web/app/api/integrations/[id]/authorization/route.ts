import { auth } from "@/lib/auth/server";
import { startIntegrationAuthorization } from "@/lib/integrations/connections";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { isIntegrationId } from "@/lib/integrations/schema";

/** Starts a sign-in and returns the provider page the user approves it on. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!isIntegrationId(id)) return new Response("Not found", { status: 404 });

  try {
    return Response.json(startIntegrationAuthorization(session.user.id, id));
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
