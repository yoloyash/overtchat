import "server-only";
import {
  APIError,
  createAuthEndpoint,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { z } from "zod";
import { findPasswordAccount, resetUserPassword } from "@/lib/db/passwords";

/** A recovery endpoint with password confirmation and atomic session revocation. */
export function passwordRecovery() {
  return {
    id: "overtchat-password-recovery",
    endpoints: {
      resetUserPassword: createAuthEndpoint(
        "/admin/reset-user-password",
        {
          method: "POST",
          body: z.object({
            userId: z.string().min(1),
            currentPassword: z.string().min(1).max(128),
            newPassword: z.string().min(1).max(128),
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
              message: "Change your own password in Security settings.",
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
          const { minPasswordLength, maxPasswordLength } =
            ctx.context.password.config;
          if (
            ctx.body.newPassword.length < minPasswordLength ||
            ctx.body.newPassword.length > maxPasswordLength
          ) {
            throw new APIError("BAD_REQUEST", {
              message: `Use between ${minPasswordLength} and ${maxPasswordLength} characters.`,
            });
          }
          const hash = await ctx.context.password.hash(ctx.body.newPassword);
          const result = resetUserPassword(ctx.body.userId, hash, {
            userId: actor.user.id,
            sessionId: actor.session.id,
            passwordHash: credential.password,
          });
          if (result === "unauthorized") {
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in again before resetting a password.",
            });
          }
          if (result === "not_found") {
            throw new APIError("NOT_FOUND", { message: "User not found." });
          }
          if (result === "no_password") {
            throw new APIError("CONFLICT", {
              message: "This account does not use a password.",
            });
          }
          return ctx.json({ status: true });
        },
      ),
    },
  };
}
