import { auth } from "@/lib/auth/server";

interface Body {
  baseUrl: string;
  apiKey?: string;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { baseUrl, apiKey } = (await req.json()) as Body;
  if (!baseUrl) return new Response("Missing baseUrl", { status: 400 });

  const url = baseUrl.replace(/\/$/, "") + "/models";
  let res: Response;
  try {
    res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Fetch failed: ${msg}` }, { status: 502 });
  }

  if (!res.ok) {
    return Response.json(
      { error: `Upstream ${res.status} ${res.statusText}` },
      { status: 502 },
    );
  }

  const json = (await res.json()) as { data?: Array<{ id: string }> };
  const ids = (json.data ?? []).map((m) => m.id).sort();
  return Response.json({ models: ids });
}
