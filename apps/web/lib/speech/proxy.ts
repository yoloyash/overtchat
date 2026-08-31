import "server-only";
import { getServerCapability } from "@/lib/db/serverCapabilities";

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

export async function proxyTranscription(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AUDIO_BYTES) {
    return new Response("Audio too large", { status: 413 });
  }
  const capability = getServerCapability("stt");
  const baseUrl =
    capability.provider === "bundled"
      ? "http://stt:5092"
      : capability.baseUrl || process.env.STT_URL;
  if (capability.provider === "disabled" || !baseUrl) {
    return Response.json({ error: "stt_unavailable" }, { status: 503 });
  }
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
  const upstream = await fetch(apiEndpoint(baseUrl, "/audio/transcriptions"), {
    method: "POST",
    body: outgoing,
    headers: providerHeaders(capability.apiKey),
    signal: request.signal,
  }).catch(() => null);
  if (!upstream) {
    return Response.json({ error: "stt_unavailable" }, { status: 503 });
  }
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function proxySpeech(
  request: Request,
  defaultFormat: "mp3" | "pcm",
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | {
        input?: string;
        text?: string;
        voice?: string;
        response_format?: string;
      }
    | null;
  const input = (body?.input ?? body?.text)?.trim();
  if (!input) return new Response("Missing text", { status: 400 });
  if (input.length > MAX_SPEECH_CHARS) {
    return new Response(`Text exceeds ${MAX_SPEECH_CHARS} chars`, { status: 413 });
  }
  const capability = getServerCapability("tts");
  const baseUrl =
    capability.provider === "bundled"
      ? "http://kokoro:8880"
      : capability.baseUrl || process.env.KOKORO_URL;
  if (capability.provider === "disabled" || !baseUrl) {
    return Response.json({ error: "tts_unavailable" }, { status: 503 });
  }
  const requestedFormat = body?.response_format;
  const responseFormat =
    requestedFormat && SPEECH_FORMATS.has(requestedFormat)
      ? requestedFormat
      : defaultFormat;
  const upstream = await fetch(apiEndpoint(baseUrl, "/audio/speech"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...providerHeaders(capability.apiKey),
    },
    body: JSON.stringify({
      model: capability.model ?? "kokoro",
      voice: body?.voice ?? capability.voice ?? "af_heart",
      input,
      response_format: responseFormat,
      stream: true,
    }),
    signal: request.signal,
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return new Response("TTS upstream unavailable", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
