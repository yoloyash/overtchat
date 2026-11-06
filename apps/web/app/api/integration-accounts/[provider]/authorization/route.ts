import { auth } from "@/lib/auth/server";
import { startIntegrationAuthorization } from "@/lib/integrations/connections";
import { integrationErrorResponse } from "@/lib/integrations/http";
import {
  IntegrationAuthorizationInputSchema,
  isIntegrationProvider,
} from "@/lib/integrations/schema";

/**
 * Starts a sign-in for the chosen integrations and returns the provider page
 * the user approves it on.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { provider } = await params;
  if (!isIntegrationProvider(provider)) {
    return new Response("Not found", { status: 404 });
  }

  const parsed = IntegrationAuthorizationInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    return Response.json(
      startIntegrationAuthorization(
        session.user.id,
        provider,
        parsed.data.integrations,
      ),
    );
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
