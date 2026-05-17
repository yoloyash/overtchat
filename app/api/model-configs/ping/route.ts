import { generateText } from "ai";
import { auth } from "@/lib/auth/server";
import { buildModel } from "@/lib/llm";

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

  const { model: llm, providerOptions } = buildModel({
    baseUrl,
    apiKey,
    model,
    extraBody,
  });

  const started = Date.now();
  try {
    const { text, usage } = await generateText({
      model: llm,
      prompt: "Say hi in one short sentence.",
      maxOutputTokens: 64,
      abortSignal: AbortSignal.timeout(30_000),
      providerOptions,
    });
    return Response.json({
      text: text.trim(),
      elapsedMs: Date.now() - started,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
