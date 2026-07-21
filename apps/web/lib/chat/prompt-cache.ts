import { createHash } from "node:crypto";
import type { ModelMessage, SystemModelMessage } from "ai";
import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";

export interface CacheBoundaryOptions {
  openAIExplicit?: boolean;
}

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
 * Add OpenAI's GPT-5.6+ explicit cache breakpoint without changing prompt
 * text. The Responses API accepts breakpoints on system and user text blocks,
 * but not assistant output blocks.
 */
export function markOpenAICacheBoundary<T extends ModelMessage>(message: T): T {
  if (message.role === "system") {
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        openai: {
          ...message.providerOptions?.openai,
          promptCacheBreakpoint: { mode: "explicit" },
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
                promptCacheBreakpoint: { mode: "explicit" },
              },
            },
          }
        : part,
    ),
  } as T;
}

/** Mark the stable system prefix for providers with explicit cache controls. */
export function markSystemCacheBoundary(
  message: SystemModelMessage,
  { openAIExplicit = false }: CacheBoundaryOptions = {},
): SystemModelMessage {
  const anthropicMessage = markAnthropicCacheBoundary(message);
  return openAIExplicit
    ? markOpenAICacheBoundary(anthropicMessage)
    : anthropicMessage;
}

/** OpenAI rejects explicit breakpoints before GPT-5.6. */
export function supportsOpenAIExplicitPromptCaching(modelId: string): boolean {
  const normalizedModelId = modelId.replace(/^openai\./i, "");
  const match = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/i.exec(normalizedModelId);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 6);
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
