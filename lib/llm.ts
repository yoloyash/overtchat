import "server-only";
import { PROVIDER_IMPLS, type BuiltModel } from "@/lib/providers/server";
import type { ProviderId } from "@/lib/providers/meta";
import type { JSONValue } from "@ai-sdk/provider";
import type { ModelConfigRow } from "@/lib/db/modelConfigs";

export function buildModel(modelConfig: ModelConfigRow): BuiltModel {
  return PROVIDER_IMPLS[modelConfig.provider as ProviderId].build({
    baseUrl: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    model: modelConfig.model,
    extraBody: modelConfig.extraBody as Record<string, JSONValue> | null,
  });
}
