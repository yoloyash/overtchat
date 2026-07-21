import type { ModelMessage, SystemModelMessage } from "ai";

/**
 * Add Anthropic's AI SDK cache breakpoint without changing the prompt text.
 */
export function markAnthropicCacheBoundary<T extends ModelMessage>(
  message: T,
): T {
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: {
        ...message.providerOptions?.anthropic,
        cacheControl: { type: "ephemeral" },
      },
    },
  };
}

/**
 * Add OpenAI's explicit cache breakpoint. Responses models attach the marker
 * to system messages or user content parts rather than assistant messages.
 */
export function markOpenAICacheBoundary<T extends ModelMessage>(
  message: T,
): T {
  if (message.role === "system") {
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        openai: {
          ...message.providerOptions?.openai,
          promptCacheBreakpoint: { type: "ephemeral" },
        },
      },
    } as T;
  }
  if (message.role !== "user") return message;

  const content =
    typeof message.content === "string"
      ? [{ type: "text" as const, text: message.content }]
      : message.content;
  const boundaryIndex = content.length - 1;

  return {
    ...message,
    content: content.map((part, index) =>
      index === boundaryIndex
        ? {
            ...part,
            providerOptions: {
              ...part.providerOptions,
              openai: {
                ...part.providerOptions?.openai,
                promptCacheBreakpoint: { type: "ephemeral" },
              },
            },
          }
        : part,
    ),
  } as T;
}

/** Mark a stable system prefix for providers with explicit cache controls. */
export function markSystemCacheBoundary(
  message: SystemModelMessage,
): SystemModelMessage {
  return markOpenAICacheBoundary(markAnthropicCacheBoundary(message));
}
