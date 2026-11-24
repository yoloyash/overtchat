/** Sign-in contract shared by the server and the web, desktop, and mobile clients. */

/** Better Auth provider ID of the server's OpenID Connect identity provider. */
export const SSO_PROVIDER_ID = "oidc";

/** How this server lets people sign in (`GET /api/sign-in-methods`, public). */
export interface SignInMethods {
  /** Email and password sign-in is on. */
  password: boolean;
  /** The server's identity provider, when one is configured. */
  sso: { name: string } | null;
}

/** Servers without the route predate single sign-on and sign in by password. */
export const PASSWORD_ONLY_SIGN_IN: SignInMethods = { password: true, sso: null };

/**
 * Apps sign in with the identity provider in the system browser, which holds
 * the user's passkeys and provider session. The app opens
 * {@link nativeSignInStartUrl} with a redirect address it listens on and the
 * SHA-256 of a secret it keeps. The server sends the browser to the provider
 * and then back to that address with a one-time code, and the app trades the
 * code and its secret for a session at {@link NATIVE_SIGN_IN_EXCHANGE_PATH}.
 * A code is useless to anything else that sees the redirect.
 */
export const NATIVE_SIGN_IN_START_PATH = "/api/native-sign-in/start";

/** Better Auth route, under `/api/auth`, that trades a code for a session. */
export const NATIVE_SIGN_IN_EXCHANGE_PATH = "/native-sign-in/exchange";

/** Where the mobile app receives the code: its login screen. */
export const MOBILE_SIGN_IN_REDIRECT = "overtchat://login";

/** Path of the desktop app's loopback listener. */
export const DESKTOP_SIGN_IN_REDIRECT_PATH = "/sign-in";

/** The desktop app's redirect address for the loopback port it listens on. */
export function desktopSignInRedirect(port: number): string {
  return `http://127.0.0.1:${port}${DESKTOP_SIGN_IN_REDIRECT_PATH}`;
}

/** Base64url without padding: a SHA-256 digest is 43 characters. */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const STATE = /^[A-Za-z0-9_-]{16,128}$/u;
const LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})\/sign-in$/u;

/**
 * Redirect addresses the server sends a code to: the mobile app's scheme, or
 * a loopback port on the machine running the browser. Nothing else, so a
 * crafted link can't deliver a code to another site.
 */
export function isNativeSignInRedirect(uri: string): boolean {
  if (uri === MOBILE_SIGN_IN_REDIRECT) return true;
  const port = LOOPBACK_REDIRECT.exec(uri)?.[1];
  return port !== undefined && Number(port) <= 65_535;
}

export function isNativeSignInChallenge(value: string): boolean {
  return CODE_CHALLENGE.test(value);
}

export function isNativeSignInState(value: string): boolean {
  return STATE.test(value);
}

export interface NativeSignInStart {
  redirectUri: string;
  /** Base64url SHA-256 of the verifier the app keeps for the exchange. */
  codeChallenge: string;
  /** Echoed on the redirect, so the app can ignore redirects it didn't start. */
  state: string;
}

/** The address an app opens in the system browser to sign in. */
export function nativeSignInStartUrl(
  serverUrl: string,
  { redirectUri, codeChallenge, state }: NativeSignInStart,
): string {
  const url = new URL(NATIVE_SIGN_IN_START_PATH, serverUrl);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("state", state);
  return url.toString();
}

/** What the redirect back to an app carried. */
export type NativeSignInResult =
  | { code: string }
  | { error: string }
  /** Not a reply to the sign-in this app started. */
  | null;

/** Reads the redirect an app received, for the `state` it sent. */
export function readNativeSignInRedirect(
  url: string,
  state: string,
): NativeSignInResult {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  if (params.get("state") !== state) return null;
  const error = params.get("error");
  if (error) return { error };
  const code = params.get("code");
  return code ? { code } : null;
}

/** Request body of {@link NATIVE_SIGN_IN_EXCHANGE_PATH}. */
export interface NativeSignInExchange {
  code: string;
  codeVerifier: string;
}

/** The sign-in was abandoned at the provider, so there is nothing to explain. */
export function signInCancelled(code: string): boolean {
  return code === "access_denied";
}

/**
 * Why signing in with the identity provider failed, from the `error` code the
 * server puts on the redirect back to the login screen or app.
 */
export function ssoErrorMessage(code: string, providerName: string): string {
  switch (code) {
    case "signup_disabled":
      return `Your ${providerName} account doesn't have an OvertChat account on this server. Ask your administrator to add you.`;
    case "account_not_linked":
    case "unable_to_link_account":
      return `Your ${providerName} account couldn't be matched to your OvertChat account. Ask your administrator for help.`;
    case "email_not_found":
    case "email_is_missing":
      return `${providerName} didn't share your email address, so OvertChat can't tell who you are. Ask your administrator to check its setup.`;
    case "banned":
    case "BANNED_USER":
      return "Your account on this server is disabled. Ask your administrator for help.";
    case "access_denied":
      return "Sign-in was cancelled.";
    case "expired":
      return "That sign-in took too long. Try again.";
    default:
      return `Couldn't sign in with ${providerName}. Try again, and ask your administrator if it keeps happening.`;
  }
}
