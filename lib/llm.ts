import "server-only";
import {
  wrapLanguageModel,
  extractReasoningMiddleware,
  type LanguageModel,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONValue } from "@ai-sdk/provider";
import { presetFor } from "@/lib/providers/meta";

// Vertex/Gemini whitelists this string to bypass thought_signature validation
// on tool_calls. Used as a fallback when an assistant tool_call in history
// has no real signature (cross-provider history, lost state, pre-fix data).
// See lobehub/lobe-chat for prior art; pydantic-ai #3881 documents the
// upstream behavior.
const SKIP_SIGNATURE = "skip_thought_signature_validator";

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
  // Provider name is the metadata key the SDK uses for provider-specific
  // fields. For Google, naming it "google" lets the SDK roundtrip
  // thought_signature on tool calls (it reads into providerMetadata[name]
  // but writes from providerOptions.google).
  const isGoogle = presetFor(baseUrl) === "google";
  const providerName = isGoogle ? "google" : "openai-compatible";

  const provider = createOpenAICompatible({
    name: providerName,
    baseURL: normalizeBaseUrl(baseUrl),
    apiKey: apiKey || "none",
    transformRequestBody: isGoogle ? stampMissingSignatures : undefined,
  });
  // Default Gemini to surface thought summaries (free — thinking tokens are
  // billed regardless). User-supplied extraBody wins at the top level.
  const mergedExtraBody = isGoogle
    ? { extra_body: GOOGLE_THINKING_DEFAULT, ...(extraBody ?? {}) }
    : extraBody;
  return {
    model: wrapLanguageModel({
      model: provider.chatModel(model),
      // DeepSeek-R1 emits <think>; Gemini's openai-compat emits <thought>.
      middleware: [
        extractReasoningMiddleware({ tagName: "thought" }),
        extractReasoningMiddleware({ tagName: "think" }),
      ],
    }),
    providerOptions: mergedExtraBody
      ? { [providerName]: mergedExtraBody as Record<string, JSONValue> }
      : undefined,
  };
}

const GOOGLE_THINKING_DEFAULT = {
  google: { thinking_config: { include_thoughts: true } },
};

interface ToolCallWithExtra {
  type?: string;
  function?: unknown;
  extra_content?: { google?: { thought_signature?: unknown } };
}

interface AssistantMessageWithToolCalls {
  role?: string;
  tool_calls?: ToolCallWithExtra[];
}

function stampMissingSignatures(args: Record<string, unknown>): Record<string, unknown> {
  const messages = args.messages;
  if (!Array.isArray(messages)) return args;
  for (const msg of messages as AssistantMessageWithToolCalls[]) {
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const call of msg.tool_calls) {
      if (call.extra_content?.google?.thought_signature) continue;
      call.extra_content = {
        ...call.extra_content,
        google: {
          ...call.extra_content?.google,
          thought_signature: SKIP_SIGNATURE,
        },
      };
    }
  }
  return args;
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
