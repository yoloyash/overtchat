import { auth } from "@/lib/auth/server";
import { getToolSettings, updateToolSettings } from "@/lib/db/tools";
import { ToolSettingsSchema } from "@/lib/toolConfig";

async function requireAdmin(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { error: new Response("Unauthorized", { status: 401 }) };
  if (session.user.role !== "admin") {
    return { error: new Response("Forbidden", { status: 403 }) };
  }
  return { session };
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  return Response.json({ settings: await getToolSettings() });
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  const parsed = ToolSettingsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const settings = await updateToolSettings(parsed.data);
  return Response.json({ settings });
}
