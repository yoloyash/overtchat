import {
  REASONING_EFFORTS,
  type ModelReasoningControls,
  type ReasoningEffort,
} from "@overtchat/shared";

const DEFAULT_REASONING_LEVELS = {
  openai: "medium",
  anthropic: "high",
  google: "high",
  deepseek: "max",
} as const satisfies Record<string, ReasoningEffort>;

type CloudReasoningProviderId = keyof typeof DEFAULT_REASONING_LEVELS;

/**
 * Converts provider-specific models.dev reasoning metadata into controls that
 * OvertChat can send without remapping. Token-budget models stay hidden until
 * the product has a native budget control.
 */
export function catalogReasoningControlsFor(
  providerId: string,
  reasoningOptions: unknown,
): ModelReasoningControls | undefined {
  if (!isCloudReasoningProvider(providerId)) return undefined;
  if (!Array.isArray(reasoningOptions)) return undefined;

  const options = reasoningOptions.filter(isRecord);
  if (options.some((option) => option.type === "budget_tokens")) {
    return undefined;
  }

  const effortValues = options.flatMap((option) =>
    option.type === "effort" && Array.isArray(option.values)
      ? option.values
      : [],
  );
  const supported = new Set(effortValues);
  const efforts = REASONING_EFFORTS.filter((effort) =>
    supported.has(effort),
  );
  if (efforts.length === 0) return undefined;

  const preferredDefault = DEFAULT_REASONING_LEVELS[providerId];
  const defaultLevel = efforts.includes(preferredDefault)
    ? preferredDefault
    : efforts.length === 1
      ? efforts[0]
      : undefined;
  if (!defaultLevel) return undefined;

  return {
    toggle:
      supported.has("none") ||
      options.some((option) => option.type === "toggle"),
    defaultLevel,
    efforts,
  };
}

function isCloudReasoningProvider(
  providerId: string,
): providerId is CloudReasoningProviderId {
  return providerId in DEFAULT_REASONING_LEVELS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
