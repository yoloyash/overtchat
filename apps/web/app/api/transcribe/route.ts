import { auth } from "@/lib/auth/server";
import { getServerCapability } from "@/lib/db/serverCapabilities";

const MAX_BYTES = 25 * 1024 * 1024;

function transcriptionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/u, "");
  return `${normalized}${normalized.endsWith("/v1") ? "" : "/v1"}/audio/transcriptions`;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len && len > MAX_BYTES) {
    return new Response("Audio too large", { status: 413 });
  }

  const capability = getServerCapability("stt");
  const baseUrl =
    capability.provider === "bundled"
      ? "http://stt:5092"
      : capability.baseUrl || process.env.STT_URL;
  if (capability.provider === "disabled" || !baseUrl) {
    return Response.json(
      { error: "stt_unavailable", role: session.user.role ?? "user" },
      { status: 503 },
    );
  }
  const incoming = await req.formData().catch(() => null);
  const file = incoming?.get("file");
  if (!(file instanceof File)) {
    return new Response("Missing audio file", { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return new Response("Audio too large", { status: 413 });
  }
  const outgoing = new FormData();
  outgoing.append("file", file, file.name);
  outgoing.append("model", capability.model ?? "parakeet-tdt-0.6b-v3");
  const headers: Record<string, string> = {};
  if (capability.apiKey) {
    headers.Authorization = `Bearer ${capability.apiKey}`;
  }

  const upstream = await fetch(transcriptionEndpoint(baseUrl), {
    method: "POST",
    body: outgoing,
    headers,
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
