import "server-only";
import {
  wrapLanguageModel,
  extractReasoningMiddleware,
  type LanguageModel,
} from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ProviderId } from "./meta";

const OPENAI_COMPAT_PROVIDER_NAME = "openai-compatible";

export interface BuildArgs {
  baseUrl: string;
  apiKey: string | null | undefined;
  model: string;
  extraBody: Record<string, JSONValue> | null | undefined;
}

export interface BuiltModel {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, JSONValue>> | undefined;
}

interface ProviderImpl {
  build(args: BuildArgs): BuiltModel;
  listModels(baseUrl: string, apiKey: string | null | undefined): Promise<string[]>;
}

const LIST_MODELS_TIMEOUT_MS = 10_000;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Upstream ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const PROVIDER_IMPLS: Record<ProviderId, ProviderImpl> = {
  "openai-compatible": {
    build({ baseUrl, apiKey, model, extraBody }) {
      const provider = createOpenAICompatible({
        name: OPENAI_COMPAT_PROVIDER_NAME,
        baseURL: normalizeBaseUrl(baseUrl),
        apiKey: apiKey || "none",
      });
      return {
        model: wrapLanguageModel({
          model: provider.chatModel(model),
          middleware: extractReasoningMiddleware({ tagName: "think" }),
        }),
        providerOptions: extraBody
          ? { [OPENAI_COMPAT_PROVIDER_NAME]: extraBody }
          : undefined,
      };
    },
    async listModels(baseUrl, apiKey) {
      const json = (await fetchJson(
        `${normalizeBaseUrl(baseUrl)}/models`,
        apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      )) as { data?: Array<{ id?: string }> };
      return (json.data ?? [])
        .map((m) => m.id ?? "")
        .filter(Boolean)
        .sort();
    },
  },

  anthropic: {
    build({ baseUrl, apiKey, model, extraBody }) {
      const provider = createAnthropic({
        baseURL: normalizeBaseUrl(baseUrl),
        apiKey: apiKey ?? undefined,
      });
      return {
        model: provider(model),
        providerOptions: extraBody ? { anthropic: extraBody } : undefined,
      };
    },
    async listModels(baseUrl, apiKey) {
      const json = (await fetchJson(
        `${normalizeBaseUrl(baseUrl)}/models?limit=1000`,
        {
          "x-api-key": apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
      )) as { data?: Array<{ id?: string }> };
      return (json.data ?? [])
        .map((m) => m.id ?? "")
        .filter(Boolean)
        .sort();
    },
  },

  google: {
    build({ baseUrl, apiKey, model, extraBody }) {
      const provider = createGoogleGenerativeAI({
        baseURL: normalizeBaseUrl(baseUrl),
        apiKey: apiKey ?? undefined,
      });
      return {
        model: provider(model),
        providerOptions: extraBody ? { google: extraBody } : undefined,
      };
    },
    async listModels(baseUrl, apiKey) {
      const url = `${normalizeBaseUrl(baseUrl)}/models?pageSize=1000${
        apiKey ? `&key=${encodeURIComponent(apiKey)}` : ""
      }`;
      const json = (await fetchJson(url, {})) as {
        models?: Array<{ name?: string }>;
      };
      return (json.models ?? [])
        .map((m) => (m.name ?? "").replace(/^models\//, ""))
        .filter(Boolean)
        .sort();
    },
  },
};
