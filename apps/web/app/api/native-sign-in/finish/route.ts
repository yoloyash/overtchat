import { auth } from "@/lib/auth/server";
import {
  createNativeSignInCode,
  takeNativeSignInRequest,
} from "@/lib/db/nativeSignIn";

/** Clocks on the session and the request are the same machine's; allow a tick. */
const CLOCK_SLACK_MS = 1_000;

/**
 * The browser returns here from the identity provider, signed in or with an
 * error, and is sent on to the app that started the sign-in with a one-time
 * code. The browser's own sign-in was only the means: unless it was signed in
 * to this server before, it is signed out again.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const request = takeNativeSignInRequest(params.get("request") ?? "");
  if (!request) {
    return new Response(
      "That sign-in took too long or was already used. Go back to the OvertChat app and try again.",
      {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const target = new URL(request.redirectUri);
  target.searchParams.set("state", request.state);
  const headers = new Headers({ "Cache-Control": "no-store" });

  const error = params.get("error");
  const session = error
    ? null
    : await auth.api.getSession({ headers: req.headers });
  // Only a sign-in that happened for this request counts, never one the
  // browser already had.
  const fresh =
    session !== null &&
    session.session.createdAt.getTime() >= request.startedAt - CLOCK_SLACK_MS;

  if (session && fresh) {
    target.searchParams.set(
      "code",
      createNativeSignInCode({
        userId: session.user.id,
        codeChallenge: request.codeChallenge,
      }),
    );
    if (!request.browserSignedIn) {
      const signedOut = await auth.api.signOut({
        headers: req.headers,
        asResponse: true,
      });
      for (const cookie of signedOut.headers.getSetCookie()) {
        headers.append("Set-Cookie", cookie);
      }
    }
  } else {
    target.searchParams.set("error", error || "sign_in_failed");
  }

  headers.set("Location", target.toString());
  return new Response(null, { status: 302, headers });
}
