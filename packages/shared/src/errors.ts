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
  code?: string,
): string {
  const feature = service === "stt" ? "Dictation" : "Read aloud";
  const provider = service === "stt" ? "transcription" : "speech playback";
  switch (code) {
    case "speech_disabled":
      return `${feature} is turned off on this server.`;
    case "speech_not_configured":
      return `${feature} hasn't been set up on this server.`;
    case "speech_unreachable":
      return `Couldn't reach the ${provider} service. Try again shortly.`;
    case "speech_timeout":
      return `The ${provider} service took too long to respond. Try again.`;
    case "speech_provider_auth":
      return `The ${provider} service rejected the server's credentials. Ask an administrator to check the speech settings.`;
    case "speech_rate_limited":
      return `The ${provider} service is busy. Try again shortly.`;
    case "speech_invalid_response":
      return `The ${provider} service returned an invalid response. Try again.`;
    default:
      return `The ${provider} service is temporarily unavailable. Try again shortly.`;
  }
}

function messageValue(value: unknown): unknown {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    const body = value as Record<string, unknown>;
    return body.error ?? body.message;
  }
  return value;
}

/** Keep useful prose, but never present response documents or stack traces as UI. */
export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  let value = messageValue(error);
  for (let depth = 0; depth < 5; depth++) {
    if (value && typeof value === "object") {
      value = messageValue(value);
      continue;
    }
    if (typeof value !== "string") return fallback;
    const message = value.trim();
    if (!message) return fallback;
    if (/^[{[]/.test(message)) {
      try {
        value = JSON.parse(message);
        continue;
      } catch {
        return fallback;
      }
    }
    if (
      /^(?:TypeError:\s*)?(?:failed to fetch|fetch failed|networkerror.*|network request failed|load failed)$/i.test(
        message,
      )
    ) {
      // Only a transport exception establishes a client connection failure.
      // A provider's "fetch failed" string can arrive in a successful HTTP exchange.
      return error instanceof TypeError || (error instanceof Error && error.name === "NetworkError")
        ? "Can't reach the server. Check your connection and try again."
        : fallback;
    }
    if (
      error instanceof Error &&
      ["TypeError", "SyntaxError", "ReferenceError"].includes(error.name)
    )
      return fallback;
    if (/^(?:HTTP |Request failed \()?401\)?$|^unauthorized$/i.test(message))
      return "Your session has expired. Sign in again.";
    if (/^(?:HTTP |Request failed \()?403\)?$|^forbidden$/i.test(message))
      return "You don't have permission to do this.";
    if (
      message.length > 500 ||
      /<\/?[a-z][^>]*>|\n\s*at\s|\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b|^(?:TypeError|SyntaxError|ReferenceError):|^(?:HTTP \d{3}|\[object Object\]|[a-z]+_[a-z_]+)$/i.test(
        message,
      )
    )
      return fallback;
    return message;
  }
  return fallback;
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
    message = speechErrorMessage(service, code);
  else if (status === 401) message = "Your session has expired. Sign in again.";
  else if (status === 403) message = "You don't have permission to do this.";
  else if (status === 429) message = "Too many requests. Try again shortly.";
  else if (service && status >= 500)
    message = speechErrorMessage(
      service,
      status === 504 ? "speech_timeout" : undefined,
    );
  else message = getErrorMessage(decoded, fallback);
  return new ApiError(message, status, code);
}
