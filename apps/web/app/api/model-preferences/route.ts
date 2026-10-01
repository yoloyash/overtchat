import { z } from "zod";
import { auth } from "@/lib/auth/server";
import {
  getModelPreferences,
  setDefaultModel,
} from "@/lib/db/modelPreferences";

const inputSchema = z.strictObject({
  defaultModelId: z.string().trim().min(1).nullable(),
});

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return new Response("Unauthorized", { status: 401 });
  return Response.json(getModelPreferences(session.user.id));
}

export async function PUT(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return new Response("Unauthorized", { status: 401 });
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid model preference" }, { status: 400 });
  }
  const preferences = setDefaultModel(
    session.user.id,
    parsed.data.defaultModelId,
  );
  if (!preferences) {
    return Response.json({ error: "Model is unavailable" }, { status: 404 });
  }
  return Response.json(preferences);
}
