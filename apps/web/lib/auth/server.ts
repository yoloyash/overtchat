import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { APIError } from "better-auth/api";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { claimManagedHostConnector } from "@/lib/db/hostConnectors";
import { passwordRecovery } from "./password-recovery";
import { initialSetup } from "./initial-setup";

const extraTrustedOrigins =
  process.env.EXTRA_TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4717",
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  trustedOrigins: ["overtchat://", ...extraTrustedOrigins],
  // The stock endpoint skips password confirmation and leaves sessions active.
  disabledPaths: ["/admin/set-user-password"],
  rateLimit: {
    customRules: {
      "/admin/reset-user-password": { window: 60, max: 5 },
      "/setup-admin": { window: 60, max: 5 },
    },
    // E2E signs up from one address in parallel workers. Everywhere else,
    // Better Auth's default applies: limits are on in production.
    enabled:
      process.env.OVERTCHAT_E2E_DISABLE_AUTH_RATE_LIMIT === "1" ? false : undefined,
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  plugins: [
    admin({ defaultRole: "user", adminRole: "admin" }),
    // Clients on other origins, like the desktop app, send the session token
    // as `Authorization: Bearer` and receive it in `set-auth-token`.
    bearer(),
    expo(),
    passwordRecovery(),
    initialSetup(),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (data, ctx) => {
          // Initial setup uses its own atomic claim. Only admins may create
          // subsequent users via the admin plugin, which sets
          // ctx.context.session. Public signup is closed.
          const sessionUser = ctx?.context?.session?.user;
          if (sessionUser?.role === "admin") return { data };
          throw new APIError("BAD_REQUEST", { message: "Signup is closed." });
        },
        after: async (createdUser) => {
          if (createdUser.role === "admin") {
            claimManagedHostConnector(createdUser.id);
          }
        },
      },
    },
  },
});
