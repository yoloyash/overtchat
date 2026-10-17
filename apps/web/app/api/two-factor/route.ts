import type { TwoFactorStatus } from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { twoFactorRequiredFor } from "@/lib/auth/two-factor";

/** The signed-in user's two-factor state and whether this server requires it. */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return Response.json({
    enabled: session.user.twoFactorEnabled === true,
    required: twoFactorRequiredFor(session.user),
  } satisfies TwoFactorStatus);
}
