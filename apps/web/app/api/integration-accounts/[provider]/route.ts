import { auth } from "@/lib/auth/server";
import {
  completeIntegrationAuthorization,
  disconnectIntegrationAccount,
} from "@/lib/integrations/connections";
import { integrationErrorResponse } from "@/lib/integrations/http";
import {
  IntegrationConnectInputSchema,
  isIntegrationProvider,
} from "@/lib/integrations/schema";

/** Finishes a sign-in from the address the user's browser ended on. */
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

  const parsed = IntegrationConnectInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const integrations = await completeIntegrationAuthorization(
      session.user.id,
      provider,
      parsed.data.redirectUrl,
    );
    return Response.json({ integrations });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}

/** Ends the sign-in, and with it every integration it covered. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { provider } = await params;
  if (!isIntegrationProvider(provider)) {
    return new Response("Not found", { status: 404 });
  }

  await disconnectIntegrationAccount(session.user.id, provider);
  return new Response(null, { status: 204 });
}
