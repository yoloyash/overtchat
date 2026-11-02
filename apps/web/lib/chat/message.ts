import { ApiError, speechErrorMessage, readableMessageText } from "@overtchat/shared";
import { remark } from "remark";
import strip from "strip-markdown";
import type { UIMessage } from "ai";
import type { DictationError } from "@/lib/useDictation";
import { stripCitationMarkers } from "@/lib/citations";

const stripper = remark().use(strip);

export function stripMarkdown(s: string): string {
  return String(stripper.processSync(s)).replace(/\s+/g, " ").trim();
}

export function textOf(message: UIMessage): string {
  return readableMessageText(message);
}

export function speakableText(message: UIMessage): string {
  return stripMarkdown(stripCitationMarkers(readableMessageText(message)));
}

export function dictationErrorMessage(
  err: DictationError,
  isAdmin: boolean,
): string {
  switch (err.kind) {
    case "permission":
      return "Microphone access denied. Allow it in your browser settings to dictate.";
    case "insecure_context":
      return "Microphone access requires HTTPS on this address. Open OvertChat over HTTPS, or use localhost on the computer running the server.";
    case "unsupported":
      return "Your browser doesn't support audio recording.";
    case "stt_unavailable":
      return speechErrorMessage("stt", err.code) +
        (!isAdmin && (err.code === "speech_disabled" || err.code === "speech_not_configured")
          ? " Ask an administrator to enable it." : "");
    case "empty":
      return "No speech detected. Try again.";
    case "other":
      return err.message;
  }
}

const CHAT_ERROR_FALLBACK = "Couldn't complete the response. Please try again.";
const CHAT_ERROR_MAX_LENGTH = 300;

/**
 * Failed responses carry the server's own text: provider errors arrive through
 * the stream's error part and route failures as the response body. Transport
 * failures (fetch rejects with a TypeError) and empty messages keep the generic
 * copy.
 */
export function chatErrorMessage(error: Error): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return CHAT_ERROR_FALLBACK;
  const message = error.message.trim();
  if (!message) return CHAT_ERROR_FALLBACK;
  return message.length > CHAT_ERROR_MAX_LENGTH
    ? `${message.slice(0, CHAT_ERROR_MAX_LENGTH - 1)}…`
    : message;
}
