import { auth } from "@/lib/auth/server";
import { RuntimeModelConfigSchema } from "@/lib/model-config/schema";
import { pingModel } from "@/lib/modelHealth";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RuntimeModelConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const result = await pingModel(parsed.data);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.kind === "configuration" ? 400 : 502 },
    );
  }
  return Response.json({
    text: result.text,
    elapsedMs: result.elapsedMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
}
