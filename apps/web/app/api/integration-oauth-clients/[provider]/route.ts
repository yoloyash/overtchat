import { auth } from "@/lib/auth/server";
import {
  deleteIntegrationOauthClient,
  getIntegrationOauthClient,
  saveIntegrationOauthClient,
  toIntegrationOauthClient,
} from "@/lib/db/integrations";
import {
  isIntegrationProvider,
  IntegrationOauthClientInputSchema,
  type IntegrationProvider,
} from "@/lib/integrations/schema";

type Context = { params: Promise<{ provider: string }> };

/** Only administrators manage a provider's client; its secret is never returned. */
async function authorize(
  request: Request,
  { params }: Context,
): Promise<IntegrationProvider | Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const { provider } = await params;
  if (!isIntegrationProvider(provider)) {
    return new Response("Not found", { status: 404 });
  }
  return provider;
}

export async function GET(request: Request, context: Context) {
  const provider = await authorize(request, context);
  if (provider instanceof Response) return provider;
  return Response.json({
    client: toIntegrationOauthClient(
      provider,
      getIntegrationOauthClient(provider),
    ),
  });
}

export async function PUT(request: Request, context: Context) {
  const provider = await authorize(request, context);
  if (provider instanceof Response) return provider;

  const parsed = IntegrationOauthClientInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const clientSecret =
    parsed.data.clientSecret ||
    getIntegrationOauthClient(provider)?.clientSecret;
  if (!clientSecret) {
    return Response.json(
      { error: "Client secret is required" },
      { status: 400 },
    );
  }
  const row = saveIntegrationOauthClient(provider, {
    clientId: parsed.data.clientId,
    clientSecret,
  });
  return Response.json({ client: toIntegrationOauthClient(provider, row) });
}

export async function DELETE(request: Request, context: Context) {
  const provider = await authorize(request, context);
  if (provider instanceof Response) return provider;
  deleteIntegrationOauthClient(provider);
  return new Response(null, { status: 204 });
}
