import { auth } from "@/lib/auth/server";
import { getServerCapability } from "@/lib/db/serverCapabilities";

const MAX_CHARS = 5000;

function speechEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/u, "");
  return `${normalized}${normalized.endsWith("/v1") ? "" : "/v1"}/audio/speech`;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { text?: string; voice?: string }
    | null;
  const text = body?.text?.trim();
  if (!text) return new Response("Missing text", { status: 400 });
  if (text.length > MAX_CHARS) {
    return new Response(`Text exceeds ${MAX_CHARS} chars`, { status: 413 });
  }

  const capability = getServerCapability("tts");
  if (capability.provider === "disabled") {
    return Response.json(
      { error: "tts_unavailable", role: session.user.role ?? "user" },
      { status: 503 },
    );
  }
  const baseUrl =
    capability.provider === "bundled"
      ? "http://kokoro:8880"
      : capability.baseUrl || process.env.KOKORO_URL;
  if (!baseUrl) {
    return Response.json(
      { error: "tts_unavailable", role: session.user.role ?? "user" },
      { status: 503 },
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (capability.apiKey) {
    headers.Authorization = `Bearer ${capability.apiKey}`;
  }

  const upstream = await fetch(speechEndpoint(baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: capability.model ?? "kokoro",
      voice: body?.voice ?? capability.voice ?? "af_heart",
      input: text,
      response_format: "mp3",
      stream: true,
    }),
    signal: req.signal,
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("TTS upstream unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
