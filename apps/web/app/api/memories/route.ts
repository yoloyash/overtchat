import { auth } from "@/lib/auth/server";
import {
  clearMemories,
  createMemory,
  MemoryCapacityError,
} from "@/lib/db/personalization";
import { MemoryInputSchema } from "@/lib/personalization/schema";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = MemoryInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  try {
    const result = createMemory(session.user.id, parsed.data);
    if (result === "conflict") {
      return Response.json(
        { error: "A memory with that key already exists." },
        { status: 409 },
      );
    }
    return Response.json({ memory: result }, { status: 201 });
  } catch (error) {
    if (error instanceof MemoryCapacityError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  await clearMemories(session.user.id);
  return new Response(null, { status: 204 });
}
