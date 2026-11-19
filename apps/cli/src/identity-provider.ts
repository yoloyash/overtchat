import type { IdentityProviderConfig, InstallationConfig } from "./types.js";

const DISCOVERY_PATH = "/.well-known/openid-configuration";
const CHECK_TIMEOUT_MS = 5_000;

/** The redirect address the operator registers with the provider. */
export function identityProviderRedirect(publicUrl: string): string {
  // The app signs in with its one provider under this fixed name.
  return `${publicUrl.replace(/\/+$/u, "")}/api/auth/callback/oidc`;
}

/** The issuer as providers document it, without the discovery path. */
export function normalizeIssuer(value: string): string {
  const issuer = value.trim().replace(/\/+$/u, "");
  return issuer.endsWith(DISCOVERY_PATH)
    ? issuer.slice(0, -DISCOVERY_PATH.length)
    : issuer;
}

export function issuerValidation(value: string | undefined): string | undefined {
  if (!value?.trim()) return "Enter the provider's issuer URL.";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Enter a valid URL, such as https://id.example.com.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Use an http:// or https:// URL.";
  }
  if (url.search || url.hash) return "Leave out anything after ? or #.";
  if (/^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1?\])$/iu.test(url.hostname)) {
    // The app reads the provider from inside its container.
    return "The app runs in a container, where localhost is the container itself. Use an address that it and people's browsers can both reach.";
  }
  return undefined;
}

/**
 * Why the provider's configuration couldn't be read from this computer, or
 * null when it could. The app reads the same address from its container, so
 * a failure here is a warning to the operator and not proof of a mistake.
 */
export async function checkIssuer(
  issuer: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetcher(`${normalizeIssuer(issuer)}${DISCOVERY_PATH}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch {
    return "it didn't answer";
  }
  if (!response.ok) return `it answered ${response.status}`;
  const document = (await response.json().catch(() => null)) as {
    authorization_endpoint?: unknown;
    token_endpoint?: unknown;
  } | null;
  if (
    typeof document?.authorization_endpoint !== "string" ||
    typeof document.token_endpoint !== "string"
  ) {
    return "the reply isn't an OpenID Connect configuration";
  }
  return null;
}

export function identityProviderSummary(config: InstallationConfig): string {
  const provider: IdentityProviderConfig | undefined = config.identityProvider;
  if (!provider) return "Identity provider: set up later";
  return `Identity provider: ${provider.name}, ${provider.disablePasswordLogin ? "passwords off" : "beside passwords"}`;
}
