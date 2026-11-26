import type { TFunction } from "i18next";
import { i18n } from "./i18n/i18n";

/** Public, transport-neutral error information shared by web and native clients. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type SpeechService = "stt" | "tts";
export type SpeechErrorCode =
  | "speech_disabled"
  | "speech_not_configured"
  | "speech_unreachable"
  | "speech_timeout"
  | "speech_provider_auth"
  | "speech_rate_limited"
  | "speech_provider_error"
  | "speech_invalid_response";

export function isSpeechErrorCode(code: unknown): code is SpeechErrorCode {
  return (
    typeof code === "string" &&
    [
      "speech_disabled",
      "speech_not_configured",
      "speech_unreachable",
      "speech_timeout",
      "speech_provider_auth",
      "speech_rate_limited",
      "speech_provider_error",
      "speech_invalid_response",
    ].includes(code)
  );
}

export function speechErrorMessage(
  service: SpeechService,
  t: TFunction,
  code?: string,
): string {
  const keys =
    service === "stt"
      ? ({
          speech_disabled: "common.errors.speech.stt.disabled",
          speech_not_configured: "common.errors.speech.stt.notConfigured",
          speech_unreachable: "common.errors.speech.stt.unreachable",
          speech_timeout: "common.errors.speech.stt.timeout",
          speech_provider_auth: "common.errors.speech.stt.providerAuth",
          speech_rate_limited: "common.errors.speech.stt.rateLimited",
          speech_invalid_response: "common.errors.speech.stt.invalidResponse",
          fallback: "common.errors.speech.stt.unavailable",
        } as const)
      : ({
          speech_disabled: "common.errors.speech.tts.disabled",
          speech_not_configured: "common.errors.speech.tts.notConfigured",
          speech_unreachable: "common.errors.speech.tts.unreachable",
          speech_timeout: "common.errors.speech.tts.timeout",
          speech_provider_auth: "common.errors.speech.tts.providerAuth",
          speech_rate_limited: "common.errors.speech.tts.rateLimited",
          speech_invalid_response: "common.errors.speech.tts.invalidResponse",
          fallback: "common.errors.speech.tts.unavailable",
        } as const);
  switch (code) {
    case "speech_disabled":
      return t(keys.speech_disabled);
    case "speech_not_configured":
      return t(keys.speech_not_configured);
    case "speech_unreachable":
      return t(keys.speech_unreachable);
    case "speech_timeout":
      return t(keys.speech_timeout);
    case "speech_provider_auth":
      return t(keys.speech_provider_auth);
    case "speech_rate_limited":
      return t(keys.speech_rate_limited);
    case "speech_invalid_response":
      return t(keys.speech_invalid_response);
    default:
      return t(keys.fallback);
  }
}

/** Only normalized API errors carry a message intended for display. */
export function getErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Accepts decoded JSON or legacy text. HTTP status alone never implies missing setup. */
export function apiError(
  status: number,
  body: unknown,
  fallback: string,
  service?: SpeechService,
): ApiError {
  let decoded = body;
  if (typeof body === "string") {
    try {
      decoded = JSON.parse(body);
    } catch {
      /* Legacy plain-text response. */
    }
  }
  const code =
    decoded &&
    typeof decoded === "object" &&
    "code" in decoded &&
    typeof decoded.code === "string"
      ? decoded.code
      : undefined;
  let message: string;
  if (service && isSpeechErrorCode(code))
    message = speechErrorMessage(service, i18n.t, code);
  else if (status === 401) message = i18n.t("common.errors.signInRequired");
  else if (status === 403) message = i18n.t("common.errors.permissionDenied");
  else if (status === 429) message = i18n.t("common.errors.tooManyRequests");
  else if (service && status >= 500)
    message = speechErrorMessage(
      service,
      i18n.t,
      status === 504 ? "speech_timeout" : undefined,
    );
  // OvertChat's API error field is public display copy. Do not unwrap nested
  // provider payloads, interpret message text, or display unknown coded errors.
  else if (
    !code &&
    decoded &&
    typeof decoded === "object" &&
    "error" in decoded &&
    typeof decoded.error === "string"
  ) message = decoded.error;
  else message = fallback;
  return new ApiError(message, status, code);
}
