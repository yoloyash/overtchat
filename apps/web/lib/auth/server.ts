import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, genericOAuth, twoFactor } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { APIError } from "better-auth/api";
import { SSO_PROVIDER_ID } from "@overtchat/shared";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { claimManagedHostConnector } from "@/lib/db/hostConnectors";
import { passwordRecovery } from "./password-recovery";
import { initialSetup } from "./initial-setup";
import { twoFactorRecovery } from "./two-factor";
import { signInApproval, signInApprovalOtp } from "./sign-in-approval";
import { isOidcCallback, oidcConfig, passwordLoginGate } from "./oidc";
import { nativeSignIn } from "./native-sign-in";

const extraTrustedOrigins =
  process.env.EXTRA_TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

export const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:4717";

const oidc = oidcConfig();

export const auth = betterAuth({
  baseURL,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  trustedOrigins: ["overtchat://", ...extraTrustedOrigins],
  // The stock endpoint skips password confirmation and leaves sessions active.
  disabledPaths: ["/admin/set-user-password"],
  rateLimit: {
    customRules: {
      "/admin/reset-user-password": { window: 60, max: 5 },
      "/setup-admin": { window: 60, max: 5 },
      // A pending sign-in waits on this while the user answers. Requests are
      // long-polled, and the plugin's default allows three per ten seconds.
      "/two-factor/approval": { window: 10, max: 10 },
      "/native-sign-in/exchange": { window: 60, max: 10 },
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
  // A person's first sign-in with the operator's identity provider joins the
  // account that has their email. The operator chose the provider, so its
  // emails are taken as true even where it doesn't report them verified, and
  // accounts here never verify theirs. From then on the provider's own ID for
  // the person identifies them.
  account: oidc
    ? {
        accountLinking: {
          trustedProviders: [SSO_PROVIDER_ID],
          requireLocalEmailVerified: false,
        },
      }
    : undefined,
  plugins: [
    admin({ defaultRole: "user", adminRole: "admin" }),
    // Clients on other origins, like the desktop app, send the session token
    // as `Authorization: Bearer` and receive it in `set-auth-token`.
    bearer(),
    expo(),
    // Authenticator apps list the server, so several servers stay apart.
    twoFactor({
      issuer: `OvertChat (${new URL(baseURL).host})`,
      otpOptions: signInApprovalOtp,
    }),
    twoFactorRecovery(),
    signInApproval(),
    passwordRecovery(),
    initialSetup(),
    passwordLoginGate(),
    nativeSignIn(),
    ...(oidc
      ? [
          genericOAuth({
            config: [
              {
                providerId: SSO_PROVIDER_ID,
                name: oidc.name,
                discoveryUrl: oidc.discoveryUrl,
                clientId: oidc.clientId,
                clientSecret: oidc.clientSecret,
                scopes: ["openid", "profile", "email"],
                // Identity comes from the ID token, so it has to be checked
                // against the provider's keys, never just decoded.
                requireIdTokenVerification: true,
                disableSignUp: !oidc.autoCreateUsers,
                // Signing out of OvertChat leaves the provider's session, and
                // the person's other apps, alone.
                disableProviderLogout: true,
              },
            ],
          }),
        ]
      : []),
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
          // The operator may let a first sign-in with their identity provider
          // create the account.
          if (oidc?.autoCreateUsers && isOidcCallback(ctx)) return { data };
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
