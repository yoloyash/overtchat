import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";

const outputKeys = [
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
  "maxTokens",
  "maxCompletionTokens",
  "maxOutputTokens",
];

/** Read explicit output allowances without mutating the request. If aliases
 * coexist, reserve the largest: precedence differs between compatible servers. */
export function configuredOutputTokens(
  options: ProviderOptions | undefined,
): number | undefined {
  const limits = Object.values(options ?? {}).flatMap((values) =>
    outputKeys.flatMap((key) => {
      const value = values[key];
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? [Math.ceil(value)]
        : [];
    }),
  );
  return limits.length ? Math.max(...limits) : undefined;
}

/** Bound summary requests only. Ordinary replies keep their original options. */
export function withSummaryOutputBudget(
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
          outputKeys.includes(key)
            ? typeof value === "number" && Number.isFinite(value) && value > 0
              ? Math.min(value, maxOutputTokens)
              : maxOutputTokens
            : value,
        ]),
      ),
    ]),
  );
}
