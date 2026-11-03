import "server-only";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getIP,
} from "better-auth/api";
import type { twoFactor } from "better-auth/plugins";
import { z } from "zod";
import type { SignInApprovalState } from "@overtchat/shared";
import {
  challengeKey,
  createSignInApproval,
  finishSignInApproval,
  hasSignInApprover,
  recentSignInRequests,
  SIGN_IN_APPROVAL_MINUTES,
  SIGN_IN_REQUEST_LIMIT,
  signInApprovalState,
} from "@/lib/db/signInApprovals";
import { notifySignInRequest } from "@/lib/notifications/sender";
import { deviceLabel } from "./device-label";

/*
 * Sign-in approval is Better Auth's two-factor one-time code, delivered by the
 * user's signed-in devices instead of by email. Sending a code records a
 * request and notifies those devices. Once one of them picks the number the
 * signing-in device shows, `/two-factor/approval` hands that device its code,
 * and it verifies the code like any other. Better Auth stays the only thing
 * that creates sessions, counts attempts, and locks accounts.
 *
 * The code is bound to the pending sign-in's cookie, so releasing it to the
 * holder of that cookie gives them nothing they couldn't verify themselves.
 */

type OtpOptions = NonNullable<
  NonNullable<Parameters<typeof twoFactor>[0]>["otpOptions"]
>;
type CookieContext = {
  context: {
    secret: string;
    createAuthCookie: (name: string) => { name: string };
  };
  getSignedCookie: (name: string, secret: string) => Promise<unknown>;
};

/** How long the signing-in device's status request waits for an answer. */
const LONG_POLL_MS = 20_000;
const POLL_INTERVAL_MS = 500;

/** The pending sign-in's cookie value, set once the password was accepted. */
async function pendingSignIn(ctx: CookieContext): Promise<string | null> {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const value = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  return typeof value === "string" && value ? value : null;
}

/**
 * The signing-in device's address, as the user's devices show it. Better Auth
 * picks it from the configured headers, but shortens IPv6 to its /64 network
 * for rate limiting, so ask for the whole address.
 */
function requestAddress(ctx: {
  request?: Request;
  headers?: Headers;
  context: { options: Parameters<typeof getIP>[1] };
}): string | null {
  const source = ctx.request ?? ctx.headers;
  if (!source) return null;
  const options = ctx.context.options;
  const ip = getIP(source, {
    ...options,
    advanced: {
      ...options.advanced,
      ipAddress: { ...options.advanced?.ipAddress, ipv6Subnet: 128 },
    },
  });
  if (!ip?.includes(":")) return ip;
  try {
    // `0000:…:0001` becomes `::1`.
    return new URL(`http://[${ip}]`).hostname.slice(1, -1);
  } catch {
    return ip;
  }
}

/** Better Auth's one-time code options: the code goes to the user's devices. */
export const signInApprovalOtp = {
  // Nobody types this code, so it can be long enough to leave nothing to guess.
  digits: 10,
  period: SIGN_IN_APPROVAL_MINUTES,
  storeOTP: "hashed",
  async sendOTP({ user, otp }, ctx) {
    const pending = ctx ? await pendingSignIn(ctx) : null;
    // The before hook refuses to send without a pending sign-in.
    if (!ctx || !pending) return;
    const device = deviceLabel(ctx.headers?.get("user-agent"));
    const request = createSignInApproval({
      userId: user.id,
      challenge: challengeKey(pending),
      code: otp,
      device,
      ipAddress: requestAddress(ctx),
    });
    // Don't hold the sign-in screen on the push service.
    void notifySignInRequest({ userId: user.id, device, ...request });
  },
} satisfies OtpOptions;

function signInApprovalError(
  status: "BAD_REQUEST" | "CONFLICT" | "TOO_MANY_REQUESTS" | "UNAUTHORIZED",
  code: string,
  message: string,
) {
  return new APIError(status, { code, message });
}

export function signInApproval() {
  return {
    id: "overtchat-sign-in-approval",
    hooks: {
      before: [
        {
          // Codes only ever go to the user's devices, for a pending sign-in
          // that one of them could approve.
          matcher: (context: { path?: string }) =>
            context.path === "/two-factor/send-otp",
          handler: createAuthMiddleware(async (ctx) => {
            const pending = await pendingSignIn(ctx);
            if (!pending) {
              throw signInApprovalError(
                "BAD_REQUEST",
                "NO_PENDING_SIGN_IN",
                "Sign in with your password first.",
              );
            }
            const verification =
              await ctx.context.internalAdapter.findVerificationValue(pending);
            if (!verification || verification.expiresAt <= new Date()) {
              throw signInApprovalError(
                "UNAUTHORIZED",
                "INVALID_TWO_FACTOR_COOKIE",
                "This sign-in expired. Enter your password again.",
              );
            }
            const userId = verification.value;
            if (!hasSignInApprover(userId)) {
              throw signInApprovalError(
                "CONFLICT",
                "NO_SIGN_IN_APPROVERS",
                "You're not signed in on any other device.",
              );
            }
            if (recentSignInRequests(userId) >= SIGN_IN_REQUEST_LIMIT) {
              throw signInApprovalError(
                "TOO_MANY_REQUESTS",
                "TOO_MANY_SIGN_IN_REQUESTS",
                "Too many sign-in requests. Wait a few minutes.",
              );
            }
          }),
        },
        {
          // An authenticator stays the way back in: approval needs a device
          // that's already signed in, which a user may not have.
          matcher: (context: { path?: string }) =>
            context.path === "/two-factor/enable",
          handler: createAuthMiddleware(async (ctx) => {
            if ((ctx.body as { method?: unknown } | undefined)?.method === "otp") {
              throw signInApprovalError(
                "BAD_REQUEST",
                "AUTHENTICATOR_REQUIRED",
                "Set up two-factor with an authenticator app.",
              );
            }
          }),
        },
      ],
      after: [
        {
          // However the sign-in finishes, its request no longer needs an
          // answer, so the user's devices stop asking about it.
          matcher: (context: { path?: string }) =>
            context.path === "/two-factor/verify-otp" ||
            context.path === "/two-factor/verify-totp" ||
            context.path === "/two-factor/verify-backup-code",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as { token?: unknown } | undefined;
            if (returned instanceof APIError || !returned?.token) return;
            const pending = await pendingSignIn(ctx);
            if (pending) finishSignInApproval(challengeKey(pending));
          }),
        },
      ],
    },
    endpoints: {
      signInApprovalStatus: createAuthEndpoint(
        "/two-factor/approval",
        {
          method: "GET",
          query: z.object({ wait: z.literal("1").optional() }).optional(),
        },
        async (ctx) => {
          const pending = await pendingSignIn(ctx);
          if (!pending) {
            throw signInApprovalError(
              "UNAUTHORIZED",
              "INVALID_TWO_FACTOR_COOKIE",
              "This sign-in expired. Enter your password again.",
            );
          }
          const challenge = challengeKey(pending);
          // With `wait`, hold the request until the answer arrives, so the
          // signing-in device learns it at once without polling.
          const deadline = Date.now() + (ctx.query?.wait ? LONG_POLL_MS : 0);
          let state: SignInApprovalState = signInApprovalState(challenge);
          while (
            state.status === "pending" &&
            Date.now() < deadline &&
            !ctx.request?.signal.aborted
          ) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            state = signInApprovalState(challenge);
          }
          ctx.setHeader("Cache-Control", "no-store");
          return ctx.json(state);
        },
      ),
    },
  };
}
