import { auth } from "@/lib/auth/server";
import {
  getPersonalizationSnapshot,
  MemoryCapacityError,
  updatePersonalization,
} from "@/lib/db/personalization";
import { PersonalizationInputSchema } from "@/lib/personalization/schema";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return Response.json(await getPersonalizationSnapshot(session.user.id));
}

export async function PATCH(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PersonalizationInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  try {
    const personalization = await updatePersonalization(
      session.user.id,
      parsed.data,
    );
    return Response.json({ personalization });
  } catch (error) {
    if (error instanceof MemoryCapacityError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
