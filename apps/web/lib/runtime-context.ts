import type { ModelMessage } from "ai";

export type WebSearchMode = "required" | "disabled" | "unavailable";

/**
 * Private, per-request state for the AI SDK tool loop. The SDK propagates this
 * object to policy callbacks, but does not put it in the model prompt.
 */
export type ChatRuntimeContext = {
  currentTurn: number;
  currentDateTime: string;
  timeZone: string;
  webSearchMode: WebSearchMode;
  webSearchAttempted: boolean;
};

export interface RuntimeContextOptions {
  turn: number;
  webSearchMode: WebSearchMode;
  timeZone?: string;
  now?: Date;
}

/** Build the single current request's runtime state from server-owned facts. */
export function buildRuntimeContext({
  turn,
  webSearchMode,
  timeZone,
  now = new Date(),
}: RuntimeContextOptions): ChatRuntimeContext {
  const normalizedTimeZone = normalizeTimeZone(timeZone);

  return {
    currentTurn: turn,
    currentDateTime: new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimeZone,
      dateStyle: "full",
      timeStyle: "long",
    }).format(now),
    timeZone: normalizedTimeZone,
    webSearchMode,
    webSearchAttempted: false,
  };
}

/**
 * Render only the facts that the model needs for this turn. This block is
 * injected into the current user message sent to the provider and is never
 * persisted in chat history.
 */
export function renderRuntimeContext(context: ChatRuntimeContext): string {
  const webSearchLine =
    context.webSearchMode === "required"
      ? "Web search: required for this turn; call web_search before answering."
      : context.webSearchMode === "disabled"
        ? "Web search: disabled by the user for this turn."
        : "Web search: unavailable for the selected model.";

  return [
    "<runtime_context>",
    `Current date/time: ${context.currentDateTime} (${context.timeZone})`,
    `Current turn: ${context.currentTurn}`,
    webSearchLine,
    "</runtime_context>",
  ].join("\n");
}

/**
 * Put ephemeral runtime context immediately before the current user content.
 * The input array and message objects are left untouched so persistence,
 * exports, search indexing, and title generation only see user-authored data.
 */
export function prependRuntimeContext(
  messages: ModelMessage[],
  runtimeText: string,
): ModelMessage[] {
  const currentUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (currentUserIndex === -1) {
    throw new Error("Runtime context requires a current user message");
  }

  return messages.map((message, index) => {
    if (index !== currentUserIndex || message.role !== "user") return message;

    const runtimePart = { type: "text" as const, text: runtimeText };
    const content =
      typeof message.content === "string"
        ? [
            runtimePart,
            { type: "text" as const, text: message.content },
          ]
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
