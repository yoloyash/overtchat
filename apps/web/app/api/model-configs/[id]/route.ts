import { auth } from "@/lib/auth/server";
import {
  deleteModelConfig,
  getModelConfig,
  toAdminModelConfig,
  updateModelConfig,
} from "@/lib/db/modelConfigs";
import { ModelConfigSchema } from "@/lib/model-config/schema";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";

async function requireAdmin(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { error: new Response("Unauthorized", { status: 401 }) };
  if (session.user.role !== "admin") {
    return { error: new Response("Forbidden", { status: 403 }) };
  }
  return { session };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const { id } = await params;
  const existing = await getModelConfig(id);
  if (!existing) return new Response("Not found", { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ModelConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  try {
    createConfiguredLanguageModel(parsed.data);
  } catch (error) {
    if (!isProviderConfigurationError(error)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }
  const row = await updateModelConfig(id, parsed.data);
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({ modelConfig: toAdminModelConfig(row) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const { id } = await params;
  await deleteModelConfig(id);
  return new Response(null, { status: 204 });
}
