import { auth } from "@/lib/auth/server";

const KOKORO_URL = process.env.KOKORO_URL ?? "http://localhost:8880";
const MAX_CHARS = 5000;

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

  const upstream = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "kokoro",
      voice: body?.voice ?? "af_heart",
      input: text,
      response_format: "mp3",
    }),
    signal: req.signal,
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("TTS upstream unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
