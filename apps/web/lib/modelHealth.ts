import "server-only";
import { generateText } from "ai";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";
import type { ProviderModelConfig } from "@/lib/providers/server/types";

export type PingResult =
  | {
      ok: true;
      text: string;
      elapsedMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { ok: false; error: string; elapsedMs: number };

export async function pingModel(
  config: ProviderModelConfig,
): Promise<PingResult> {
  const { model, providerOptions } = createConfiguredLanguageModel(config);
  const started = Date.now();
  try {
    const { text, usage } = await generateText({
      model,
      prompt: "Say hi in one short sentence.",
      maxOutputTokens: 64,
      abortSignal: AbortSignal.timeout(30_000),
      providerOptions,
    });
    return {
      ok: true,
      text: text.trim(),
      elapsedMs: Date.now() - started,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}
