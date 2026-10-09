import { auth } from "@/lib/auth/server";
import { getModelConfig, modelConfigForUser } from "@/lib/db/modelConfigs";
import { pingModel } from "@/lib/modelHealth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const stored = await getModelConfig(id);
  if (!stored) return new Response("Not found", { status: 404 });
  // A per-user model is tested with the administrator's own credential.
  const row = modelConfigForUser(stored, session.user.id);
  if (!row) {
    return Response.json(
      {
        ok: false,
        error: "Add your own credential for this model to test its connection.",
        elapsedMs: 0,
      },
      { status: 200 },
    );
  }

  if (row.modelType === "image") return Response.json({ error: "Image models do not use chat connection tests." }, { status: 400 });

  const result = await pingModel({
    providerId: row.providerId,
    apiFormat: row.apiFormat,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
    providerOptions: row.providerOptions,
    toolCallingEnabled: row.toolCallingEnabled,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, elapsedMs: result.elapsedMs },
      { status: 200 },
    );
  }
  return Response.json({
    ok: true,
    elapsedMs: result.elapsedMs,
  });
}
