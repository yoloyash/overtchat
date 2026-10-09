import { auth } from "@/lib/auth/server";
import {
  deleteModelUserCredential,
  getModelConfig,
  getModelUserCredential,
  setModelUserCredential,
} from "@/lib/db/modelConfigs";
import { userExists } from "@/lib/db/users";
import { ModelUserCredentialSchema } from "@/lib/model-config/schema";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";

type Params = { params: Promise<{ id: string; userId: string }> };

async function requireAdmin(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

/** Set one user's credential for a per-user model (the key is write-only). */
export async function PUT(req: Request, { params }: Params) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id, userId } = await params;
  const row = await getModelConfig(id);
  if (!row) return new Response("Not found", { status: 404 });
  if (row.credentialScope !== "user") {
    return Response.json(
      { error: "This model uses a shared connection" },
      { status: 400 },
    );
  }
  if (!userExists(userId)) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ModelUserCredentialSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const apiKey =
    parsed.data.apiKey === undefined
      ? (getModelUserCredential(id, userId)?.apiKey ?? null)
      : parsed.data.apiKey;
  try {
    // The same provider checks a shared connection gets (required key, endpoint).
    createConfiguredLanguageModel({
      ...row,
      apiKey,
      baseUrl: parsed.data.baseUrl ?? row.baseUrl,
    });
  } catch (error) {
    if (!isProviderConfigurationError(error)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({
    credential: setModelUserCredential(id, userId, parsed.data),
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id, userId } = await params;
  return deleteModelUserCredential(id, userId)
    ? new Response(null, { status: 204 })
    : new Response("Not found", { status: 404 });
}
