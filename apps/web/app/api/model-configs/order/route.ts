import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { reorderModelConfigs } from "@/lib/db/modelConfigs";

const inputSchema = z.strictObject({
  modelIds: z
    .array(z.string().min(1))
    .refine((ids) => new Set(ids).size === ids.length),
});

export async function PUT(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin")
    return new Response("Forbidden", { status: 403 });
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid model order" }, { status: 400 });
  if (!reorderModelConfigs(parsed.data.modelIds)) {
    return Response.json(
      { error: "The model list changed. Refresh and try again." },
      { status: 409 },
    );
  }
  return Response.json({ modelIds: parsed.data.modelIds });
}
