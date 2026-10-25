import "server-only";
import { APIError, createAuthEndpoint, formCsrfMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { createInitialAdmin, setupCodeMatches } from "@/lib/db/initialSetup";

export function initialSetup() {
  return {
    id: "overtchat-initial-setup",
    endpoints: {
      setupAdmin: createAuthEndpoint("/setup-admin", {
        method: "POST",
        use: [formCsrfMiddleware],
        body: z.object({
          code: z.string().min(1).max(64),
          name: z.string().trim().min(1).max(200),
          email: z.email().transform((value) => value.toLowerCase()),
          password: z.string().min(8).max(128),
        }),
      }, async (ctx) => {
        const invalid = () => new APIError("BAD_REQUEST", {
          message: "Setup code is incorrect or setup is already complete.",
        });
        if (!setupCodeMatches(ctx.body.code)) throw invalid();
        const passwordHash = await ctx.context.password.hash(ctx.body.password);
        // Recheck authorization inside the transaction after asynchronous hashing.
        const user = createInitialAdmin({ ...ctx.body, passwordHash });
        if (!user) throw invalid();
        // Account creation is committed. If session creation fails, the owner
        // can sign in with the credential just saved rather than retry setup.
        try {
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (session) {
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ token: session.token, user });
          }
        } catch {
          ctx.context.logger.error("Initial account created, but automatic sign-in failed.");
        }
        return ctx.json({ token: null, user });
      }),
    },
  };
}
