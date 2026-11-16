import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { agentClientRegistry } from "@/lib/notifications/presence";

const presenceSchema = z.strictObject({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  visible: z.boolean(),
  viewing: z.string().min(1).max(200).nullable(),
  notify: z.boolean(),
  // A day is as idle as it gets; clients that predate this leave it out.
  idleMs: z.number().int().min(0).max(86_400_000).optional(),
});

/**
 * A web or desktop client's heartbeat: whether it can be seen and what it
 * shows. Any signed-in user reports in, since chat replies follow presence
 * too; agent alerts are still only planned for sessions an admin owns.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const parsed = presenceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid presence." }, { status: 400 });
  }
  agentClientRegistry.record(session.user.id, parsed.data);
  return new Response(null, { status: 204 });
}
