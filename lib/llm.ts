import "server-only";
import {
  wrapLanguageModel,
  extractReasoningMiddleware,
  type LanguageModel,
} from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelConfigRow } from "@/lib/db/modelConfigs";

const PROVIDER_NAME = "user-endpoint";

export function buildModel(modelConfig: ModelConfigRow): {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, JSONValue>> | undefined;
} {
  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: modelConfig.baseUrl.replace(/\/$/, ""),
    apiKey: modelConfig.apiKey || "none",
  });
  const model = wrapLanguageModel({
    model: provider.chatModel(modelConfig.model),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
  const providerOptions = modelConfig.extraBody
    ? { [PROVIDER_NAME]: modelConfig.extraBody as Record<string, JSONValue> }
    : undefined;
  return { model, providerOptions };
}
