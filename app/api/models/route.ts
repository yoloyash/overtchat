import { auth } from "@/lib/auth/server";
import { PROVIDER_IMPLS } from "@/lib/providers/server";
import type { ProviderId } from "@/lib/providers/meta";

interface Body {
  provider: ProviderId;
  baseUrl: string;
  apiKey?: string;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const { provider, baseUrl, apiKey } = (await req.json()) as Body;
  if (!baseUrl) return new Response("Missing baseUrl", { status: 400 });

  try {
    const models = await PROVIDER_IMPLS[provider].listModels(baseUrl, apiKey);
    return Response.json({ models });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
