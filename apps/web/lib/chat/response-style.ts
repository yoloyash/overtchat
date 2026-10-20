import type { UIMessage } from "ai";

// Versioned per turn: changing this policy must not rewrite earlier model input.
export const VOICE_RESPONSE_STYLE_V1 = "For this response only: your answer will be spoken aloud. Keep it concise, natural, and easy to follow when heard, unless the user asks for detail. Avoid unnecessary visual formatting or reading raw URLs. Still provide requested code, sources, and other useful material in the chat. If a likely speech transcription error changes the meaning, ask a brief clarifying question.";

export function withTurnResponseStyle(message: UIMessage, style: "text" | "voice"): UIMessage {
  // Incoming metadata must not be able to choose a historical instruction version.
  const metadata = { ...(message.metadata as Record<string, unknown> | undefined) };
  delete metadata.responseStyle;
  if (style === "voice") metadata.responseStyle = "voice-v1";
  const rest = { ...message };
  delete rest.metadata;
  return Object.keys(metadata).length ? { ...rest, metadata } : rest;
}

/** A presentation hint on its original user turn, never a mutation of system/history. */
export function withResponseStyle(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => message.role === "user" &&
    (message.metadata as Record<string, unknown> | undefined)?.responseStyle === "voice-v1"
    ? { ...message, parts: [...message.parts, { type: "text" as const, text: `\n[Response style]\n${VOICE_RESPONSE_STYLE_V1}\n[/Response style]` }] }
    : message);
}
