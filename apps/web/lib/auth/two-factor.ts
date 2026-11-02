import "server-only";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { TWO_FACTOR_CLIENT_HEADER } from "@overtchat/shared";
import { z } from "zod";
import { findPasswordAccount } from "@/lib/db/passwords";
import { resetUserTwoFactor } from "@/lib/db/twoFactor";

/**
 * Set by the management CLI when the server is reachable through OvertChat
 * Cloud. Administrators then have to set up two-factor before using the app;
 * everyone else may choose to.
 */
export function adminTwoFactorRequired(): boolean {
  return /^(1|true|yes)$/iu.test(
    process.env.OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR?.trim() ?? "",
  );
}

export function twoFactorRequiredFor(user: Record<string, unknown>): boolean {
  return user.role === "admin" && adminTwoFactorRequired();
}

/** Administrator recovery for lost authenticators, and the admin requirement. */
export function twoFactorRecovery() {
  return {
    id: "overtchat-two-factor-recovery",
    hooks: {
      after: [
        {
          // Runs after the two-factor plugin has replaced the sign-in
          // response with its code-step redirect.
          matcher: (context: { path?: string }) =>
            context.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as
              | { twoFactorRedirect?: unknown }
              | undefined;
            if (
              returned?.twoFactorRedirect === true &&
              !ctx.headers?.get(TWO_FACTOR_CLIENT_HEADER)
            ) {
              throw new APIError("BAD_REQUEST", {
                code: "TWO_FACTOR_CLIENT_UPDATE_REQUIRED",
                message:
                  "This account uses two-factor authentication. Update OvertChat to sign in.",
              });
            }
          }),
        },
      ],
      before: [
        {
          matcher: (context: { path?: string }) =>
            context.path === "/two-factor/disable",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (session && twoFactorRequiredFor(session.user)) {
              throw new APIError("FORBIDDEN", {
                message:
                  "Administrators on this server must keep two-factor authentication on.",
              });
            }
          }),
        },
      ],
    },
    endpoints: {
      resetUserTwoFactor: createAuthEndpoint(
        "/admin/reset-user-two-factor",
        {
          method: "POST",
          body: z.object({
            userId: z.string().min(1),
            currentPassword: z.string().min(1).max(128),
          }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          const actor = ctx.context.session;
          if (actor.user.role !== "admin") {
            throw new APIError("FORBIDDEN", {
              message: "Administrator access is required.",
            });
          }
          if (actor.user.id === ctx.body.userId) {
            throw new APIError("BAD_REQUEST", {
              message: "Manage your own two-factor in Security settings.",
            });
          }
          const credential = findPasswordAccount(actor.user.id);
          if (
            !credential?.password ||
            !(await ctx.context.password.verify({
              hash: credential.password,
              password: ctx.body.currentPassword,
            }))
          ) {
            throw new APIError("BAD_REQUEST", {
              message: "Your current password is incorrect.",
            });
          }
          const result = resetUserTwoFactor(ctx.body.userId, {
            userId: actor.user.id,
            sessionId: actor.session.id,
            passwordHash: credential.password,
          });
          if (result === "unauthorized") {
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in again before resetting two-factor.",
            });
          }
          if (result === "not_found") {
            throw new APIError("NOT_FOUND", { message: "User not found." });
          }
          if (result === "not_enabled") {
            throw new APIError("CONFLICT", {
              message: "This user hasn't set up two-factor.",
            });
          }
          return ctx.json({ status: true });
        },
      ),
    },
  };
}
