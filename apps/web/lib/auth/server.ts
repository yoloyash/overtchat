import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { count } from "drizzle-orm";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  plugins: [
    admin({ defaultRole: "user", adminRole: "admin" }),
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
      },
    },
  },
});
