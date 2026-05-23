import { auth } from "@/lib/auth/server";
import { pingModel } from "@/lib/modelHealth";

interface Body {
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  extraBody?: Record<string, unknown> | null;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const { baseUrl, apiKey, model, extraBody } = (await req.json()) as Body;

  if (!baseUrl || !model) {
    return Response.json(
      { error: "baseUrl and model are required" },
      { status: 400 },
    );
  }

  const result = await pingModel({ baseUrl, apiKey, model, extraBody });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json({
    text: result.text,
    elapsedMs: result.elapsedMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
}
