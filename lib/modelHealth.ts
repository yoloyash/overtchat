import "server-only";
import { generateText } from "ai";
import { buildModel } from "@/lib/llm";

export interface PingArgs {
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  extraBody?: Record<string, unknown> | null;
}

export type PingResult =
  | {
      ok: true;
      text: string;
      elapsedMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { ok: false; error: string; elapsedMs: number };

export async function pingModel(args: PingArgs): Promise<PingResult> {
  const { model: llm, providerOptions } = buildModel({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey ?? null,
    model: args.model,
    extraBody: args.extraBody ?? null,
  });
  const started = Date.now();
  try {
    const { text, usage } = await generateText({
      model: llm,
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
