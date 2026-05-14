import { auth } from "@/lib/auth/server";

const STT_URL = process.env.STT_URL ?? "http://localhost:5092";
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len && len > MAX_BYTES) {
    return new Response("Audio too large", { status: 413 });
  }

  const upstream = await fetch(`${STT_URL}/v1/audio/transcriptions`, {
    method: "POST",
    body: req.body,
    // @ts-expect-error duplex is required by Node when streaming a body
    duplex: "half",
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/octet-stream",
    },
    signal: req.signal,
  }).catch(() => null);

  if (!upstream) {
    return Response.json(
      { error: "stt_unavailable", role: session.user.role ?? "user" },
      { status: 503 },
    );
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

