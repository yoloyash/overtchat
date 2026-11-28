import { ApiError, readableMessageText } from "@overtchat/shared";
import type { TFunction } from "i18next";
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

function sttUnavailableMessage(
  code: string | undefined,
  isAdmin: boolean,
  t: TFunction,
): string {
  switch (code) {
    case "speech_disabled":
      return isAdmin
        ? t("chat.dictation.errors.disabled")
        : t("chat.dictation.errors.disabledNonAdmin");
    case "speech_not_configured":
      return isAdmin
        ? t("chat.dictation.errors.notConfigured")
        : t("chat.dictation.errors.notConfiguredNonAdmin");
    case "speech_unreachable":
      return t("chat.dictation.errors.unreachable");
    case "speech_timeout":
      return t("chat.dictation.errors.timeout");
    case "speech_provider_auth":
      return t("chat.dictation.errors.providerAuth");
    case "speech_rate_limited":
      return t("chat.dictation.errors.rateLimited");
    case "speech_invalid_response":
      return t("chat.dictation.errors.invalidResponse");
    default:
      return t("chat.dictation.errors.unavailable");
  }
}

export function dictationErrorMessage(
  err: DictationError,
  isAdmin: boolean,
  t: TFunction,
): string {
  switch (err.kind) {
    case "permission":
      return t("chat.dictation.errors.permission");
    case "insecure_context":
      return t("chat.dictation.errors.insecureContext");
    case "unsupported":
      return t("chat.dictation.errors.unsupported");
    case "stt_unavailable":
      return sttUnavailableMessage(err.code, isAdmin, t);
    case "empty":
      return t("chat.dictation.errors.empty");
    case "other":
      return err.message;
  }
}

const CHAT_ERROR_MAX_LENGTH = 300;

/**
 * Failed responses carry the server's own text: provider errors arrive through
 * the stream's error part and route failures as the response body. Transport
 * failures (fetch rejects with a TypeError) and empty messages keep the generic
 * copy.
 */
export function chatErrorMessage(error: Error, t: TFunction): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return t("chat.errors.responseFailed");
  const message = error.message.trim();
  if (!message) return t("chat.errors.responseFailed");
  return message.length > CHAT_ERROR_MAX_LENGTH
    ? `${message.slice(0, CHAT_ERROR_MAX_LENGTH - 1)}…`
    : message;
}
