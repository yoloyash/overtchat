import { auth } from "@/lib/auth/server";
import { getIntegration, setIntegrationAlwaysOn } from "@/lib/db/integrations";
import {
  IntegrationSettingsInputSchema,
  isIntegrationId,
} from "@/lib/integrations/schema";

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
