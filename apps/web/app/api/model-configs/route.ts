import { auth } from "@/lib/auth/server";
import {
  createModelConfig,
  listModelConfigs,
  toAdminModelConfig,
  type ModelConfigRow,
} from "@/lib/db/modelConfigs";
import { ModelConfigSchema, type PublicModelConfig } from "@/lib/config";
import { PRESETS, presetFor } from "@/lib/providers/meta";

function toPublic(row: ModelConfigRow): PublicModelConfig {
  return {
    id: row.id,
    label: row.label,
    displayProvider: PRESETS[presetFor(row.baseUrl)].label,
    model: row.model,
    hasExtraBody: !!row.extraBody && Object.keys(row.extraBody).length > 0,
  };
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const wantAdmin = url.searchParams.get("admin") === "1";
  const rows = await listModelConfigs();

  if (wantAdmin) {
    if (session.user.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }
    return Response.json({ modelConfigs: rows.map(toAdminModelConfig) });
  }
  return Response.json({
    modelConfigs: rows.filter((r) => r.enabled).map(toPublic),
  });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const parsed = ModelConfigSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const row = await createModelConfig(parsed.data);
  return Response.json({ modelConfig: toAdminModelConfig(row) }, { status: 201 });
}
