import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { ProviderConnectionSchema } from "@/lib/model-config/schema";
import { ReasoningOverrideSchema } from "@/lib/model-config/reasoning-override";
import { createTemplateRenderer } from "@/lib/providers/server/http";
import { checkThinkingLevels } from "@/lib/providers/server/thinking-check";

const ThinkingCheckSchema = ProviderConnectionSchema.and(
  z.object({
    model: z.string().trim().min(1, "Model is required"),
    reasoningOverride: ReasoningOverrideSchema,
  }),
);

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
  const parsed = ThinkingCheckSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { providerId, baseUrl, apiKey, model, reasoningOverride } =
    parsed.data;
  if (providerId !== "vllm" && providerId !== "llamacpp") {
    return Response.json(
      { error: "Checking thinking levels requires vLLM or llama.cpp." },
      { status: 400 },
    );
  }
  return Response.json(
    await checkThinkingLevels(
      createTemplateRenderer(providerId, baseUrl, apiKey, model),
      reasoningOverride.requests,
    ),
  );
}
