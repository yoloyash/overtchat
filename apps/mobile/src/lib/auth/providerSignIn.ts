import {
  MOBILE_SIGN_IN_REDIRECT,
  nativeSignInStartUrl,
  readNativeSignInRedirect,
  type NativeSignInExchange,
} from "@overtchat/shared";

/** How a sign-in with the identity provider ended; `error` is a server code. */
export type ProviderSignInResult = { ok: true } | { ok: false; error: string };

/** What the sign-in needs from the device, so tests can stand in for it. */
export interface ProviderSignInDevice {
  randomBytes(count: number): Uint8Array;
  sha256(text: string): Promise<Uint8Array>;
  /**
   * Opens the address in the system's sign-in browser and resolves with the
   * redirect it came back with, or null when the user closed it.
   */
  openBrowser(url: string, redirectUri: string): Promise<string | null>;
  /** Trades the code for a session and keeps it; false when refused. */
  exchange(grant: NativeSignInExchange): Promise<boolean>;
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    text += ALPHABET[a >> 2];
    text += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) text += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) text += ALPHABET[c & 63];
  }
  return text;
}

/**
 * Signs in with the server's identity provider in the system browser, which
 * has the user's passkeys and provider session; see
 * `@overtchat/shared/sign-in`.
 */
export async function signInWithProvider(
  serverUrl: string,
  device: ProviderSignInDevice,
): Promise<ProviderSignInResult> {
  const codeVerifier = base64Url(device.randomBytes(48));
  const state = base64Url(device.randomBytes(24));
  const url = nativeSignInStartUrl(serverUrl, {
    redirectUri: MOBILE_SIGN_IN_REDIRECT,
    codeChallenge: base64Url(await device.sha256(codeVerifier)),
    state,
  });
  const redirect = await device.openBrowser(url, MOBILE_SIGN_IN_REDIRECT);
  if (!redirect) return { ok: false, error: "access_denied" };
  // Another app can open this app's scheme; only this sign-in's reply counts.
  const result = readNativeSignInRedirect(redirect, state);
  if (!result) return { ok: false, error: "sign_in_failed" };
  if ("error" in result) return { ok: false, error: result.error };
  const signedIn = await device.exchange({ code: result.code, codeVerifier });
  return signedIn ? { ok: true } : { ok: false, error: "expired" };
}

