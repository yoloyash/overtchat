export const INFERENCE_ACTIVITY_DATA_TYPE = "data-inference-activity";

export interface InferenceActivity {
  phase: "prompt" | "generation";
  completedTokens: number;
  totalTokens?: number;
  cachedTokens?: number;
  elapsedMs?: number;
  progress?: number;
  tokensPerSecond?: number;
}

export function isInferenceActivity(value: unknown): value is InferenceActivity {
  if (!isRecord(value)) return false;
  if (value.phase !== "prompt" && value.phase !== "generation") return false;
  if (!isNonNegativeNumber(value.completedTokens)) return false;
  if (!isOptionalNonNegativeNumber(value.totalTokens)) return false;
  if (!isOptionalNonNegativeNumber(value.cachedTokens)) return false;
  if (!isOptionalNonNegativeNumber(value.elapsedMs)) return false;
  if (!isOptionalNonNegativeNumber(value.tokensPerSecond)) return false;
  if (
    value.progress !== undefined &&
    (!isNonNegativeNumber(value.progress) || value.progress > 1)
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || isNonNegativeNumber(value);
}
