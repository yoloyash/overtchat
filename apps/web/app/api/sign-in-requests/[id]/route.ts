import type { SignInDecisionResult } from "@overtchat/shared";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { decideSignInRequest } from "@/lib/db/signInApprovals";

const decisionSchema = z.discriminatedUnion("approve", [
  z.object({ approve: z.literal(true), number: z.number().int().min(10).max(99) }),
  z.object({ approve: z.literal(false) }),
]);

/** Approves or denies a pending sign-in from one of the user's signed-in devices. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const login = await auth.api.getSession({ headers: req.headers });
  if (!login) return new Response("Unauthorized", { status: 401 });
  if (login.session.impersonatedBy) {
    return new Response("Forbidden", { status: 403 });
  }
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid decision." }, { status: 400 });
  }
  const result = decideSignInRequest({
    id: (await params).id,
    userId: login.user.id,
    sessionId: login.session.id,
    decision: parsed.data,
  });
  if (result === "not_found") return new Response("Not found", { status: 404 });
  return Response.json(
    { result } satisfies { result: SignInDecisionResult },
    { status: result === "expired" ? 409 : 200 },
  );
}
