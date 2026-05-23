import { auth } from "@/lib/auth/server";
import { getModelConfig } from "@/lib/db/modelConfigs";
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
  const row = await getModelConfig(id);
  if (!row) return new Response("Not found", { status: 404 });

  const result = await pingModel({
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
    extraBody: row.extraBody,
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
