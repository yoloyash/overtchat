import "server-only";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { SSO_PROVIDER_ID, type SignInMethods } from "@overtchat/shared";

/** The operator's OpenID Connect identity provider, from the environment. */
export interface OidcConfig {
  /** What the sign-in button calls the provider. */
  name: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  /** A first sign-in creates the account instead of needing one to exist. */
  autoCreateUsers: boolean;
}

type Env = Record<string, string | undefined>;

const DISCOVERY_PATH = "/.well-known/openid-configuration";
const REQUIRED = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const;

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes)$/iu.test(value?.trim() ?? "");
}

/** Accepts the issuer, as providers document it, or its discovery document. */
export function oidcDiscoveryUrl(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${path.endsWith(DISCOVERY_PATH) ? path : path + DISCOVERY_PATH}`;
}

/**
 * Single sign-on is on once the issuer, client ID, and client secret are all
 * set. A partial or unusable configuration leaves it off and says why, so a
 * typo can't take the login screen down.
 */
export function readOidcConfig(
  env: Env = process.env,
  warn: (message: string) => void = console.error,
): OidcConfig | null {
  const values = REQUIRED.map((name) => env[name]?.trim() ?? "");
  if (values.every((value) => !value)) return null;
  const missing = REQUIRED.filter((_, index) => !values[index]);
  if (missing.length) {
    warn(`Single sign-on is off: ${missing.join(", ")} must also be set.`);
    return null;
  }
  const [issuer, clientId, clientSecret] = values;
  const discoveryUrl = oidcDiscoveryUrl(issuer);
  if (!discoveryUrl) {
    warn("Single sign-on is off: OIDC_ISSUER_URL must be an http(s) URL.");
    return null;
  }
  return {
    name: env.OIDC_PROVIDER_NAME?.trim() || "SSO",
    discoveryUrl,
    clientId,
    clientSecret,
    autoCreateUsers: enabled(env.OIDC_AUTO_CREATE_USERS),
  };
}

let cached: OidcConfig | null | undefined;

/** The configuration this process started with. */
export function oidcConfig(): OidcConfig | null {
  if (cached === undefined) cached = readOidcConfig();
  return cached;
}

/**
 * Passwords can only be turned off while single sign-on is configured;
 * otherwise nobody could sign in.
 */
export function passwordLoginEnabled(
  env: Env = process.env,
  oidc: OidcConfig | null = oidcConfig(),
): boolean {
  return !(oidc && enabled(env.OIDC_DISABLE_PASSWORD_LOGIN));
}

export function signInMethods(): SignInMethods {
  const oidc = oidcConfig();
  return {
    password: passwordLoginEnabled(),
    sso: oidc ? { name: oidc.name } : null,
  };
}

/** The address the operator registers with the provider as the redirect URI. */
export function oidcCallbackUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, "")}/api/auth/callback/${SSO_PROVIDER_ID}`;
}

/** Whether a user-creation hook is running for a sign-in with the provider. */
export function isOidcCallback(
  ctx: { path?: string; params?: Record<string, unknown> } | null | undefined,
): boolean {
  return ctx?.path === "/callback/:id" && ctx.params?.id === SSO_PROVIDER_ID;
}

/**
 * Refuses password sign-in when the operator turned it off. Hiding the form
 * is not enough: the endpoint would still accept a password.
 */
export function passwordLoginGate() {
  return {
    id: "overtchat-password-login",
    hooks: {
      before: [
        {
          matcher: (context: { path?: string }) =>
            context.path === "/sign-in/email",
          handler: createAuthMiddleware(async () => {
            if (passwordLoginEnabled()) return;
            throw new APIError("FORBIDDEN", {
              code: "PASSWORD_LOGIN_DISABLED",
              message: `This server signs in with ${oidcConfig()?.name ?? "single sign-on"}.`,
            });
          }),
        },
      ],
    },
  };
}
