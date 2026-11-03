import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { connectionAccessError } from "@/lib/agents/access";
import { agentClientRegistry } from "@/lib/notifications/presence";

const presenceSchema = z.strictObject({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  visible: z.boolean(),
  viewing: z.string().min(1).max(200).nullable(),
  notify: z.boolean(),
});

/** A web or desktop client's heartbeat: whether it can be seen and what it shows. */
export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }
  const parsed = presenceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid presence." }, { status: 400 });
  }
  agentClientRegistry.record(session.user.id, parsed.data);
  return new Response(null, { status: 204 });
}
