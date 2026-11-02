/**
 * Better Auth keeps a sign-in that is waiting for a two-factor code in a
 * signed cookie. The UI runs at `overtchat://app`, where the server's cookies
 * are third-party, so main holds that one cookie and sends it back only with
 * the two-factor requests that need it.
 */
const PENDING_COOKIE = /^((?:__Secure-)?better-auth\.two_factor)=([^;]*)(.*)$/i;

/**
 * Reads the pending sign-in cookie from `Set-Cookie` headers: `name=value` when
 * set, `null` when the server expires it, or `undefined` when untouched.
 */
export function pendingTwoFactorCookie(
  setCookies: readonly string[],
): string | null | undefined {
  let result: string | null | undefined;
  for (const header of setCookies) {
    const match = PENDING_COOKIE.exec(header.trim());
    if (!match) continue;
    const [, name, value, attributes] = match;
    const expired = !value || /;\s*max-age=(0|-\d+)\b/i.test(attributes);
    result = expired ? null : `${name}=${value}`;
  }
  return result;
}

/** Whether a request to the server needs the pending sign-in cookie. */
export function needsTwoFactorCookie(pathname: string): boolean {
  return pathname.startsWith("/api/auth/two-factor/");
}
