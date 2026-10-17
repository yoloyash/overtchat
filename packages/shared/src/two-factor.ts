/** Two-factor sign-in contract shared by the web, desktop, and mobile clients. */

/** Authenticator apps show six-digit codes; backup codes look like `aB3dE-fG4hI`. */
export const TOTP_CODE_LENGTH = 6;

/** The server's two-factor state for the signed-in user (`GET /api/two-factor`). */
export interface TwoFactorStatus {
  enabled: boolean;
  /** The server requires this user, an administrator, to use two-factor. */
  required: boolean;
}

const MESSAGES: Record<string, string> = {
  INVALID_CODE: "That code didn't work. Check your authenticator and try again.",
  INVALID_BACKUP_CODE: "That backup code didn't work or was already used.",
  INVALID_TWO_FACTOR_COOKIE: "This sign-in expired. Enter your password again.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE:
    "Too many wrong codes. Enter your password again.",
  ACCOUNT_TEMPORARILY_LOCKED:
    "Too many wrong codes. Wait 15 minutes, then try again.",
};

/** A user-facing message for a Better Auth two-factor error. */
export function twoFactorErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  fallback = "Could not verify the code. Try again.",
): string {
  return (error?.code && MESSAGES[error.code]) || error?.message || fallback;
}

/** Whether a two-factor error means the sign-in has to start over. */
export function twoFactorSignInExpired(
  error: { code?: string } | null | undefined,
): boolean {
  return (
    error?.code === "INVALID_TWO_FACTOR_COOKIE" ||
    error?.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
  );
}
