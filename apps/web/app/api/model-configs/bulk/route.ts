import { auth } from "@/lib/auth/server";
import { createModelConfigs, toAdminModelConfig } from "@/lib/db/modelConfigs";
import { adminModelConfigForClient } from "@/lib/model-config/legacy-clients";
import {
  ModelConfigsSchema,
  connectionForValidation,
} from "@/lib/model-config/schema";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";

/** Adds several chat models in one change: every model is saved, or none. */
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

  const parsed = ModelConfigsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  for (const input of parsed.data.modelConfigs) {
    try {
      createConfiguredLanguageModel(connectionForValidation(input));
    } catch (error) {
      if (!isProviderConfigurationError(error)) throw error;
      return Response.json(
        { error: `${input.model}: ${error.message}` },
        { status: 400 },
      );
    }
  }
  const rows = createModelConfigs(parsed.data.modelConfigs);
  return Response.json(
    {
      modelConfigs: rows.map((row) =>
        adminModelConfigForClient(req, toAdminModelConfig(row)),
      ),
    },
    { status: 201 },
  );
}
