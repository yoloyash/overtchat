import type { TwoFactorStatus } from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { passwordLoginEnabled } from "@/lib/auth/oidc";
import { twoFactorRequiredFor } from "@/lib/auth/two-factor";
import { findPasswordAccount } from "@/lib/db/passwords";

/** The signed-in user's two-factor state and whether this server requires it. */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  // Two-factor guards password sign-in, so it means nothing to an account
  // that can't sign in that way.
  const passwordSignIn =
    passwordLoginEnabled() &&
    Boolean(findPasswordAccount(session.user.id)?.password);
  return Response.json({
    enabled: session.user.twoFactorEnabled === true,
    required: passwordSignIn && twoFactorRequiredFor(session.user),
    passwordSignIn,
  } satisfies TwoFactorStatus);
}
