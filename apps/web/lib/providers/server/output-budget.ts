import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";

/** Keep provider-specific output overrides within the SDK's reserved budget,
 * preserving smaller operator limits on OpenAI-compatible extra body fields. */
export function withOutputBudget(
  options: ProviderOptions | undefined,
  maxOutputTokens: number,
): ProviderOptions | undefined {
  if (!options) return options;
  return Object.fromEntries(
    Object.entries(options).map(([provider, values]) => [
      provider,
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          [
            "max_tokens",
            "max_completion_tokens",
            "maxTokens",
            "maxCompletionTokens",
            "maxOutputTokens",
          ].includes(key)
            ? typeof value === "number" && Number.isFinite(value) && value > 0
              ? Math.min(value, maxOutputTokens)
              : maxOutputTokens
            : value,
        ]),
      ),
    ]),
  );
}
