import "server-only";
import type { InferenceActivity } from "@/lib/chat/inference-activity";

export function readLlamaCppInferenceActivity(
  value: unknown,
): InferenceActivity | null {
  if (!isRecord(value)) return null;

  const timings = isRecord(value.timings) ? value.timings : null;
  const generatedTokens = nonNegativeNumber(timings?.predicted_n);
  if (generatedTokens !== undefined && generatedTokens > 0) {
    const elapsedMs = nonNegativeNumber(timings?.predicted_ms);
    const tokensPerSecond = nonNegativeNumber(timings?.predicted_per_second);
    return {
      phase: "generation",
      completedTokens: generatedTokens,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      ...(tokensPerSecond !== undefined && tokensPerSecond > 0
        ? { tokensPerSecond }
        : {}),
    };
  }

  const prompt = isRecord(value.prompt_progress)
    ? value.prompt_progress
    : null;
  if (!prompt) return null;

  const total = nonNegativeNumber(prompt.total);
  const cached = nonNegativeNumber(prompt.cache);
  const processed = nonNegativeNumber(prompt.processed);
  const elapsedMs = nonNegativeNumber(prompt.time_ms);
  if (
    total === undefined ||
    total <= 0 ||
    cached === undefined ||
    processed === undefined ||
    cached > total
  ) {
    return null;
  }

  // Cached prefix tokens do not perform prompt evaluation work. Match the
  // llama.cpp UI by reporting progress over only the uncached portion.
  const totalTokens = total - cached;
  const completedTokens = Math.min(
    Math.max(processed - cached, 0),
    totalTokens,
  );
  const progress = totalTokens === 0 ? 1 : completedTokens / totalTokens;

  return {
    phase: "prompt",
    completedTokens,
    totalTokens,
    cachedTokens: cached,
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    progress,
    ...(elapsedMs !== undefined && elapsedMs > 0 && completedTokens > 0
      ? { tokensPerSecond: (completedTokens / elapsedMs) * 1_000 }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
