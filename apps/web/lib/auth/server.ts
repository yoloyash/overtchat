import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { count } from "drizzle-orm";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { claimManagedHostConnector } from "@/lib/db/hostConnectors";

const extraTrustedOrigins =
  process.env.EXTRA_TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4717",
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  trustedOrigins: ["overtchat://", ...extraTrustedOrigins],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  plugins: [
    admin({ defaultRole: "user", adminRole: "admin" }),
    expo(),
    nextCookies(),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (data, ctx) => {
          const [{ n }] = await db.select({ n: count() }).from(schema.user);
          // Bootstrap: first user ever becomes admin.
          if (n === 0) return { data: { ...data, role: "admin" } };
          // Otherwise, only admins may create users (via the admin plugin,
          // which sets ctx.context.session). Public signup is closed.
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
