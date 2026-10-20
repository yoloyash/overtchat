import "server-only";
import {
  speechErrorMessage,
  type SpeechErrorCode,
  type SpeechService,
} from "@overtchat/shared";
import { getServerCapability } from "@/lib/db/serverCapabilities";

type SpeechConfig = Pick<
  ReturnType<typeof getServerCapability>,
  "provider" | "baseUrl" | "apiKey" | "model" | "voice"
>;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_SPEECH_CHARS = 5_000;
const SPEECH_FORMATS = new Set(["aac", "flac", "mp3", "opus", "pcm", "wav"]);

function apiEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/$/u, "");
  return `${normalized}${normalized.endsWith("/v1") ? "" : "/v1"}${path}`;
}

function providerHeaders(apiKey: string | null): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function speechFailure(
  service: SpeechService,
  code: SpeechErrorCode,
  status: number,
): Response {
  const response = Response.json(
    { error: speechErrorMessage(service, code), code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
  return response;
}

async function upstreamFailure(
  service: SpeechService,
  response: Response,
): Promise<Response> {
  await response.body?.cancel().catch(() => {});
  // Log status, never provider bodies, credentials, URLs, or submitted content.
  console.warn("Speech provider rejected request", {
    service,
    status: response.status,
  });
  if (response.status === 401 || response.status === 403)
    return speechFailure(service, "speech_provider_auth", 502);
  if (response.status === 429)
    return speechFailure(service, "speech_rate_limited", 429);
  if (response.status === 408 || response.status === 504)
    return speechFailure(service, "speech_timeout", 504);
  return speechFailure(service, "speech_provider_error", 502);
}

async function fetchSpeech(
  service: SpeechService,
  request: Request,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: request.signal,
    });
    return response.ok ? response : upstreamFailure(service, response);
  } catch (error) {
    // A cancelled caller must not be reported as a service outage.
    if (request.signal.aborted) throw error;
    const code = "speech_unreachable";
    console.warn("Speech provider request failed", { service, code });
    return speechFailure(service, code, 502);
  }
}

export async function proxyTranscription(
  request: Request,
  capability: SpeechConfig = getServerCapability("stt"),
): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    return new Response("Audio too large", { status: 413 });
  }
  const baseUrl =
    capability.provider === "bundled"
      ? process.env.OVERTCHAT_BUNDLED_STT_URL || "http://stt:5092"
      : capability.baseUrl || process.env.STT_URL;
  if (capability.provider === "disabled")
    return speechFailure("stt", "speech_disabled", 503);
  if (!baseUrl) return speechFailure("stt", "speech_not_configured", 503);
  const incoming = await request.formData().catch(() => null);
  const file = incoming?.get("file");
  if (!(file instanceof File)) {
    return new Response("Missing audio file", { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return new Response("Audio too large", { status: 413 });
  }
  const outgoing = new FormData();
  outgoing.append("file", file, file.name);
  outgoing.append("model", capability.model ?? "parakeet-tdt-0.6b-v3");
  const responseFormat = incoming?.get("response_format");
  if (responseFormat === "json" || responseFormat === "text") {
    outgoing.append("response_format", responseFormat);
  }
  const language = incoming?.get("language");
  if (typeof language === "string" && language.trim()) {
    outgoing.append("language", language.trim());
  }
  const upstream = await fetchSpeech(
    "stt",
    request,
    apiEndpoint(baseUrl, "/audio/transcriptions"),
    {
      method: "POST",
      body: outgoing,
      headers: providerHeaders(
        capability.provider === "bundled"
          ? process.env.OVERTCHAT_BUNDLED_SPEECH_TOKEN || null
          : capability.apiKey,
      ),
    },
  );
  if (!upstream.ok) return upstream;
  try {
    const bytes = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get("content-type") ?? "application/json";
    if (responseFormat !== "text") {
      let result: unknown;
      try {
        result = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        /* Invalid provider response. */
      }
      if (
        !result ||
        typeof result !== "object" ||
        !("text" in result) ||
        typeof result.text !== "string"
      ) {
        return speechFailure("stt", "speech_invalid_response", 502);
      }
    }
    return new Response(bytes, {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return speechFailure("stt", "speech_unreachable", 502);
  }
}

export async function proxySpeech(
  request: Request,
  defaultFormat: "mp3" | "pcm",
  capability: SpeechConfig = getServerCapability("tts"),
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    input?: string;
    text?: string;
    voice?: string;
    response_format?: string;
  } | null;
  const rawInput = body?.input ?? body?.text;
  const input = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!input) return new Response("Missing text", { status: 400 });
  if (input.length > MAX_SPEECH_CHARS) {
    return new Response(`Text exceeds ${MAX_SPEECH_CHARS} chars`, {
      status: 413,
    });
  }
  const baseUrl =
    capability.provider === "bundled"
      ? process.env.OVERTCHAT_BUNDLED_TTS_URL || "http://kokoro:8880"
      : capability.baseUrl || process.env.KOKORO_URL;
  if (capability.provider === "disabled")
    return speechFailure("tts", "speech_disabled", 503);
  if (!baseUrl) return speechFailure("tts", "speech_not_configured", 503);
  const requestedFormat = body?.response_format;
  const responseFormat =
    requestedFormat && SPEECH_FORMATS.has(requestedFormat)
      ? requestedFormat
      : defaultFormat;
  const upstream = await fetchSpeech(
    "tts",
    request,
    apiEndpoint(baseUrl, "/audio/speech"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...providerHeaders(
          capability.provider === "bundled"
            ? process.env.OVERTCHAT_BUNDLED_SPEECH_TOKEN || null
            : capability.apiKey,
        ),
      },
      body: JSON.stringify({
        model: capability.model ?? "kokoro",
        voice: body?.voice ?? capability.voice ?? "af_heart",
        input,
        response_format: responseFormat,
        stream: true,
      }),
    },
  );
  if (!upstream.ok) return upstream;
  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  if (
    !upstream.body ||
    (!contentType.startsWith("audio/") &&
      !contentType.startsWith("application/octet-stream"))
  ) {
    await upstream.body?.cancel().catch(() => {});
    return speechFailure("tts", "speech_invalid_response", 502);
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
