import { auth } from "@/lib/auth/server";
import {
  completeIntegrationAuthorization,
  disconnectIntegration,
} from "@/lib/integrations/connections";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { getIntegration, setIntegrationAlwaysOn } from "@/lib/db/integrations";
import {
  IntegrationConnectInputSchema,
  IntegrationSettingsInputSchema,
  isIntegrationId,
} from "@/lib/integrations/schema";

/** Finishes a sign-in from the address the user's browser ended on. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!isIntegrationId(id)) return new Response("Not found", { status: 404 });

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
    const integration = await completeIntegrationAuthorization(
      session.user.id,
      id,
      parsed.data.redirectUrl,
    );
    return Response.json({ integration });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}

/** Changes how the user's own connection is used. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!isIntegrationId(id)) return new Response("Not found", { status: 404 });

  const parsed = IntegrationSettingsInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  if (!setIntegrationAlwaysOn(session.user.id, id, parsed.data.alwaysOn)) {
    return Response.json(
      { error: "This account is not connected." },
      { status: 409 },
    );
  }
  return Response.json({ integration: getIntegration(session.user.id, id) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!isIntegrationId(id)) return new Response("Not found", { status: 404 });

  await disconnectIntegration(session.user.id, id);
  return new Response(null, { status: 204 });
}
