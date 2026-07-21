import type { ModelMessage } from "ai";
import {
  markAnthropicCacheBoundary,
  markOpenAICacheBoundary,
  type CacheBoundaryOptions,
} from "@/lib/chat/prompt-cache";

export type WebSearchMode = "enabled" | "disabled" | "unavailable";

/**
 * Private, per-request state for the AI SDK tool loop. The SDK propagates this
 * object to policy callbacks, but does not put it in the model prompt.
 */
export type ChatRuntimeContext = {
  currentDateTime: string;
  timeZone: string;
  webSearchMode: WebSearchMode;
};

export interface RuntimeContextOptions {
  webSearchMode: WebSearchMode;
  timeZone?: string;
  now?: Date;
}

/** Build the single current request's runtime state from server-owned facts. */
export function buildRuntimeContext({
  webSearchMode,
  timeZone,
  now = new Date(),
}: RuntimeContextOptions): ChatRuntimeContext {
  const normalizedTimeZone = normalizeTimeZone(timeZone);

  const dateTimeParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );

  return {
    currentDateTime: `${dateTimeParts.year}-${dateTimeParts.month}-${dateTimeParts.day} ${dateTimeParts.hour}:${dateTimeParts.minute}`,
    timeZone: normalizedTimeZone,
    webSearchMode,
  };
}

/**
 * Render only the facts that the model needs for this turn. This block is
 * injected into the current user message sent to the provider and is never
 * persisted in chat history.
 */
export function renderRuntimeContext(context: ChatRuntimeContext): string {
  const webLines =
    context.webSearchMode === "enabled"
      ? [
          "Web tools: enabled. Use web_search for discovery or fetch_url for a provided URL when useful.",
        ]
      : context.webSearchMode === "disabled"
        ? ["Web tools: disabled by the user."]
        : ["Web tools: unavailable for the selected model."];

  return [
    "<runtime_context>",
    `Current time: ${context.currentDateTime} ${context.timeZone}`,
    ...webLines,
    "</runtime_context>",
  ].join("\n");
}

/**
 * Put ephemeral runtime context immediately before the current user content.
 * The preceding message gets Anthropic's cache boundary. Native GPT-5.6+
 * requests also mark the preceding user message, the latest Responses API
 * block type that supports an explicit OpenAI boundary. The input array and
 * messages are left untouched so persistence and exports only see
 * user-authored data. Other providers use their implicit prefix caches.
 */
export function prependRuntimeContext(
  messages: ModelMessage[],
  runtimeText: string,
  { openAIExplicit = false }: CacheBoundaryOptions = {},
): ModelMessage[] {
  const currentUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (currentUserIndex === -1) {
    throw new Error("Runtime context requires a current user message");
  }
  const priorUserIndex = openAIExplicit
    ? messages.findLastIndex(
        (message, index) => index < currentUserIndex && message.role === "user",
      )
    : -1;
  return messages.map((message, index): ModelMessage => {
    let preparedMessage: ModelMessage = message;
    if (index === currentUserIndex - 1) {
      preparedMessage = markAnthropicCacheBoundary(preparedMessage);
    }
    if (index === priorUserIndex) {
      preparedMessage = markOpenAICacheBoundary(preparedMessage);
    }
    if (index !== currentUserIndex || message.role !== "user") {
      return preparedMessage;
    }

    const runtimePart = { type: "text" as const, text: runtimeText };
    const content =
      typeof message.content === "string"
        ? [runtimePart, { type: "text" as const, text: message.content }]
        : [runtimePart, ...message.content];

    return { ...message, content };
  });
}

export function normalizeTimeZone(timeZone?: string): string {
  if (!timeZone) return "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "UTC";
  }
}
