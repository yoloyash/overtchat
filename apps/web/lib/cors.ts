const allowedOrigins = (() => {
  const raw = process.env.EXTRA_TRUSTED_ORIGINS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
})();

function allowOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (allowedOrigins.has(origin)) return origin;
  if (origin.startsWith("exp://") || origin.startsWith("overtchat://")) return origin;
  return null;
}

export function corsHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = allowOrigin(req.headers.get("origin"));
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return headers;
}

export function withCors(req: Request, res: Response): Response {
  const extra = corsHeaders(req);
  if ([...extra.keys()].length === 0) return res;
  const merged = new Headers(res.headers);
  extra.forEach((v, k) => merged.set(k, v));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
