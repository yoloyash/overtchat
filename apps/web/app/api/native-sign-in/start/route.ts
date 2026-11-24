import {
  SSO_PROVIDER_ID,
  isNativeSignInChallenge,
  isNativeSignInRedirect,
  isNativeSignInState,
} from "@overtchat/shared";
import { limitNativeSignInStart } from "@/lib/auth/native-sign-in";
import { oidcConfig } from "@/lib/auth/oidc";
import { auth, baseURL } from "@/lib/auth/server";
import { createNativeSignInRequest } from "@/lib/db/nativeSignIn";

function refuse(status: number, message: string, retryAfter?: number) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

/**
 * An app opens this in the system browser to sign in with the identity
 * provider; see `@overtchat/shared/sign-in`. It sends the browser to the
 * provider, to come back through `finish`.
 */
export async function GET(req: Request) {
  if (!oidcConfig()) return refuse(404, "This server has no single sign-on.");
  const params = new URL(req.url).searchParams;
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const state = params.get("state") ?? "";
  if (
    !isNativeSignInRedirect(redirectUri) ||
    !isNativeSignInChallenge(codeChallenge) ||
    !isNativeSignInState(state)
  ) {
    return refuse(
      400,
      "This sign-in link isn't valid. Start again from the OvertChat app.",
    );
  }
  const wait = limitNativeSignInStart();
  if (wait) {
    return refuse(
      429,
      "Too many sign-ins are starting. Try again in a minute.",
      wait,
    );
  }

  const session = await auth.api.getSession({ headers: req.headers });
  const request = createNativeSignInRequest({
    redirectUri,
    codeChallenge,
    state,
    browserSignedIn: session !== null,
  });
  const finish = `${baseURL}/api/native-sign-in/finish?request=${request}`;
  const started = await auth.api.signInSocial({
    body: {
      provider: SSO_PROVIDER_ID,
      callbackURL: finish,
      errorCallbackURL: finish,
      disableRedirect: true,
    },
    headers: req.headers,
    asResponse: true,
  });
  const { url } = started.ok
    ? ((await started.json()) as { url?: string })
    : { url: undefined };
  if (!url) {
    return refuse(
      502,
      "Couldn't reach the sign-in provider. Try again in a moment.",
    );
  }
  const headers = new Headers({ Location: url, "Cache-Control": "no-store" });
  // The provider's reply is checked against cookies this browser now holds.
  for (const cookie of started.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}
