import { auth } from "@/lib/auth/server";
import {
  createModelConfig,
  isModelAvailableToUser,
  listCredentialedModelIds,
  listModelConfigs,
  toAdminModelConfig,
  type ModelConfigRow,
} from "@/lib/db/modelConfigs";
import {
  ModelConfigSchema,
  connectionForValidation,
  type PublicModelConfig,
} from "@/lib/model-config/schema";
import { getProvider, modelIconForModel } from "@/lib/providers/catalog";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import {
  resolveModelCapabilities,
  resolveModelContextWindow,
} from "@/lib/providers/server/model-catalog";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";

function toPublic(row: ModelConfigRow): PublicModelConfig {
  const provider = getProvider(row.providerId);
  return {
    id: row.id,
    label: row.label,
    displayProvider: provider.label,
    providerIconId: provider.iconId ?? undefined,
    modelIconId: modelIconForModel(row.model) ?? undefined,
    model: row.model,
    contextWindow: resolveModelContextWindow(
      row.contextWindow,
      row.discoveredContextWindow,
      row.providerId,
      row.model,
    ),
    capabilities: resolveModelCapabilities(
      row.discoveredCapabilities,
      row.providerId,
      row.model,
    ),
    hasProviderOptions:
      !!row.providerOptions && Object.keys(row.providerOptions).length > 0,
    toolCallingEnabled: row.toolCallingEnabled,
  };
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const wantAdmin = url.searchParams.get("admin") === "1";
  const rows = await listModelConfigs();

  if (wantAdmin) {
    if (session.user.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }
    return Response.json({ modelConfigs: rows.map(toAdminModelConfig) });
  }
  const credentialed = listCredentialedModelIds(session.user.id);
  return Response.json({
    modelConfigs: rows
      .filter(
        (r) =>
          r.enabled &&
          r.modelType !== "image" &&
          isModelAvailableToUser(r, credentialed),
      )
      .map(toPublic),
  });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

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
    if (parsed.data.modelType !== "image")
      createConfiguredLanguageModel(connectionForValidation(parsed.data));
  } catch (error) {
    if (!isProviderConfigurationError(error)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }
  const row = await createModelConfig(parsed.data);
  return Response.json(
    { modelConfig: toAdminModelConfig(row) },
    { status: 201 },
  );
}
