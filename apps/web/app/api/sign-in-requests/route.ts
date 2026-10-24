import type { SignInRequest } from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { pendingSignInRequests } from "@/lib/db/signInApprovals";

/** Sign-ins to the user's account waiting for approval on a signed-in device. */
export async function GET(req: Request) {
  const login = await auth.api.getSession({ headers: req.headers });
  if (!login) return new Response("Unauthorized", { status: 401 });
  // Someone acting as the user can't approve sign-ins for them.
  const requests: SignInRequest[] = login.session.impersonatedBy
    ? []
    : pendingSignInRequests(login.user.id);
  return Response.json(requests, { headers: { "Cache-Control": "no-store" } });
}
