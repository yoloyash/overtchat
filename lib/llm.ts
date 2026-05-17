import "server-only";
import {
  wrapLanguageModel,
  extractReasoningMiddleware,
  type LanguageModel,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONValue } from "@ai-sdk/provider";

const PROVIDER_NAME = "openai-compatible";

export interface BuildArgs {
  baseUrl: string;
  apiKey: string | null | undefined;
  model: string;
  extraBody: Record<string, unknown> | null | undefined;
}

export interface BuiltModel {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, JSONValue>> | undefined;
}

export function buildModel({ baseUrl, apiKey, model, extraBody }: BuildArgs): BuiltModel {
  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: normalizeBaseUrl(baseUrl),
    apiKey: apiKey || "none",
  });
  return {
    model: wrapLanguageModel({
      model: provider.chatModel(model),
      // DeepSeek-R1 emits <think>; Gemini's openai-compat emits <thought>.
      middleware: [
        extractReasoningMiddleware({ tagName: "thought" }),
        extractReasoningMiddleware({ tagName: "think" }),
      ],
    }),
    providerOptions: extraBody
      ? { [PROVIDER_NAME]: extraBody as Record<string, JSONValue> }
      : undefined,
  };
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export async function listOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<string[]> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Upstream ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => (m.id ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
}
