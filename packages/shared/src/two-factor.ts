/** Two-factor sign-in contract shared by the web, desktop, and mobile clients. */

/**
 * Sent with password sign-in by clients that can show the code step. The
 * server refuses a two-factor sign-in without it, so older apps that would
 * otherwise do nothing tell the user to update instead.
 */
export const TWO_FACTOR_CLIENT_HEADER = "X-OvertChat-Two-Factor";

/** Authenticator apps show six-digit codes; backup codes look like `aB3dE-fG4hI`. */
export const TOTP_CODE_LENGTH = 6;

/** The server's two-factor state for the signed-in user (`GET /api/two-factor`). */
export interface TwoFactorStatus {
  enabled: boolean;
  /** The server requires this user, an administrator, to use two-factor. */
  required: boolean;
}

/**
 * The two-factor method `POST /sign-in/email` lists in `twoFactorMethods` when
 * the server can ask the user's signed-in devices to approve the sign-in.
 */
export const SIGN_IN_APPROVAL_METHOD = "otp";

/** A sign-in waiting for approval, as the user's signed-in devices show it. */
export interface SignInRequest {
  id: string;
  /** The browser or app and its operating system, like "Chrome on macOS". */
  device: string;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  /** The number shown on the signing-in device is one of these. */
  choices: number[];
}

/** The answer a signed-in device gives (`POST /api/sign-in-requests/:id`). */
export type SignInDecision = { approve: true; number: number } | { approve: false };

/** The result of a decision, or why it no longer applies. */
export type SignInDecisionResult =
  | "approved"
  | "denied"
  | "mismatch"
  | "expired";

/**
 * What the signing-in device sees (`GET /api/auth/two-factor/approval`). Once
 * approved, it receives the one-time code to verify like any other.
 */
export type SignInApprovalState =
  | { status: "pending"; number: number; expiresAt: string }
  | { status: "approved"; code: string }
  | { status: "denied" | "mismatch" | "expired" };

/** Why an approval request ended without signing in, as the signing-in device shows it. */
export const SIGN_IN_APPROVAL_ENDED: Record<
  Exclude<SignInApprovalState["status"], "pending" | "approved">,
  string
> = {
  denied: "The sign-in was denied on your other device.",
  mismatch: "The wrong number was picked, so the sign-in was blocked.",
  expired: "The request expired. Send a new one or use another method.",
};

const MESSAGES: Record<string, string> = {
  NO_SIGN_IN_APPROVERS:
    "You're not signed in on any other device. Use your authenticator app instead.",
  TOO_MANY_SIGN_IN_REQUESTS:
    "Too many sign-in requests. Wait a few minutes or use your authenticator app.",
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

type SignInApprovalAnswer = Exclude<SignInApprovalState, { status: "pending" }>;

// React Native's AbortSignal has no `throwIfAborted`.
function stopIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error("Aborted");
}

/**
 * Waits for the user's other device to answer a sign-in approval request.
 * `read` loads `GET /api/auth/two-factor/approval`; with `wait`, the server
 * holds it open until the answer arrives. A dropped connection is retried a
 * few times before giving up.
 */
export async function waitForSignInApproval({
  read,
  onPending,
  signal,
  retryDelayMs = 2_000,
  maxFailures = 5,
}: {
  read: (wait: boolean) => Promise<SignInApprovalState>;
  onPending: (state: Extract<SignInApprovalState, { status: "pending" }>) => void;
  signal: AbortSignal;
  retryDelayMs?: number;
  maxFailures?: number;
}): Promise<SignInApprovalAnswer> {
  let wait = false;
  let failures = 0;
  for (;;) {
    stopIfAborted(signal);
    let state: SignInApprovalState;
    try {
      state = await read(wait);
      failures = 0;
    } catch (error) {
      stopIfAborted(signal);
      if (++failures >= maxFailures) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    stopIfAborted(signal);
    if (state.status !== "pending") return state;
    onPending(state);
    wait = true;
  }
}
