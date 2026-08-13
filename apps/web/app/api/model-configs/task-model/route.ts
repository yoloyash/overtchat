import { z } from "zod";
import { auth } from "@/lib/auth/server";
import {
  setTaskModelConfig,
  toAdminModelConfig,
} from "@/lib/db/modelConfigs";

const TaskModelSelectionSchema = z.object({
  modelConfigId: z.string().trim().min(1).nullable(),
});

export async function PUT(req: Request) {
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

  const parsed = TaskModelSelectionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const result = setTaskModelConfig(parsed.data.modelConfigId);
  if (result.status === "not_found") {
    return Response.json({ error: "Model config not found" }, { status: 404 });
  }

  return Response.json({
    taskModel: result.modelConfig
      ? toAdminModelConfig(result.modelConfig)
      : null,
  });
}
