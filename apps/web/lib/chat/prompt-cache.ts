import { createHash } from "node:crypto";
import type { ModelMessage, SystemModelMessage } from "ai";
import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";
import type { AnthropicCacheControl } from "@/lib/providers/server/types";

const DEFAULT_ANTHROPIC_CACHE_CONTROL: AnthropicCacheControl = {
  type: "ephemeral",
};

/**
 * Add Anthropic's AI SDK cache breakpoint without changing the prompt text.
 */
export function markAnthropicCacheBoundary<T extends ModelMessage>(
  message: T,
  cacheControl: AnthropicCacheControl = DEFAULT_ANTHROPIC_CACHE_CONTROL,
): T {
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: {
        ...message.providerOptions?.anthropic,
        cacheControl,
      },
    },
  };
}

/**
 * Mark the latest user message. Anthropic writes the growing conversation
 * through that turn, so the next request can reuse the complete prior prefix
 * while the prompt itself remains append-only and byte-for-byte unchanged.
 */
export function markAnthropicConversationCacheBoundary(
  messages: ModelMessage[],
  cacheControl?: AnthropicCacheControl,
): ModelMessage[] {
  const boundaryIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (boundaryIndex < 0) return messages;

  return messages.map((message, index) =>
    index === boundaryIndex
      ? markAnthropicCacheBoundary(message, cacheControl)
      : message,
  );
}

/** Mark the stable tools + system prefix for Anthropic prompt caching. */
export function markAnthropicSystemCacheBoundary(
  message: SystemModelMessage,
  cacheControl?: AnthropicCacheControl,
): SystemModelMessage {
  return markAnthropicCacheBoundary(message, cacheControl);
}

/** Add a stable per-chat routing key without overriding an admin setting. */
export function withOpenAIPromptCacheKey(
  providerOptions: ProviderOptions | undefined,
  cacheKey: string,
): ProviderOptions {
  const configuredCacheKey = providerOptions?.openai?.promptCacheKey;
  return {
    ...providerOptions,
    openai: {
      ...providerOptions?.openai,
      promptCacheKey:
        configuredCacheKey !== undefined ? configuredCacheKey : cacheKey,
    },
  };
}

/** Keep client-supplied chat IDs out of provider routing metadata. */
export function promptCacheKeyForChat(chatId: string): string {
  const digest = createHash("sha256").update(chatId).digest("base64url");
  return `chat:${digest}`;
}
