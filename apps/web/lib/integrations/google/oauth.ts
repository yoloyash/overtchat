import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { IntegrationError } from "@/lib/integrations/errors";

/**
 * Google sends the browser here after approval. The client is a "Desktop app"
 * client, whose loopback redirect needs no registration and no public address,
 * so the flow works however this server is reached. Nothing listens on the
 * port: the user copies the address the browser ends on back into OvertChat.
 */
export const GOOGLE_REDIRECT_URI = "http://localhost:1";

const ENDPOINTS = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revocation: "https://oauth2.googleapis.com/revoke",
  gmailProfile: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  primaryCalendar: "https://www.googleapis.com/calendar/v3/calendars/primary",
} as const;

const REQUEST_TIMEOUT_MS = 15_000;

/** End-to-end tests answer for Google from a local stand-in. */
export function googleUrl(url: string): string {
  const override = process.env.OVERTCHAT_E2E_GOOGLE_ORIGIN;
  if (!override) return url;
  const { pathname, search } = new URL(url);
  return `${override}${pathname}${search}`;
}

function endpoint(name: keyof typeof ENDPOINTS): string {
  return googleUrl(ENDPOINTS[name]);
}

export interface GoogleOauthClient {
  clientId: string;
  clientSecret: string;
}

export interface GoogleTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  /** Present on a first exchange; a refresh usually omits it. */
  refreshToken: string | null;
  scopes: string[];
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function createAuthorizationSecrets(): {
  state: string;
  codeVerifier: string;
} {
  return {
    state: base64Url(randomBytes(24)),
    codeVerifier: base64Url(randomBytes(48)),
  };
}

export function googleAuthorizationUrl(input: {
  clientId: string;
  scopes: readonly string[];
  state: string;
  codeVerifier: string;
  /** The account to preselect, when the user is signing in to it again. */
  loginHint?: string;
}): string {
  const url = new URL(endpoint("authorization"));
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: input.scopes.join(" "),
    state: input.state,
    code_challenge: base64Url(
      createHash("sha256").update(input.codeVerifier).digest(),
    ),
    code_challenge_method: "S256",
    // Google issues a refresh token only for offline access, and only on a
    // fresh consent once the account has approved this client before.
    access_type: "offline",
    prompt: "consent",
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return url.toString();
}

/** Reads the code out of the address the browser ended on. */
export function parseAuthorizationResponse(input: string): {
  code: string;
  state: string;
} {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new IntegrationError(
      "That is not the address from your browser. Copy the whole address, starting with http://localhost.",
      400,
    );
  }
  const error = url.searchParams.get("error");
  if (error) {
    throw new IntegrationError(
      error === "access_denied"
        ? "Google reported that access was not allowed. Start again and choose Allow."
        : `Google reported an error (${error}). Start again.`,
      400,
    );
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    throw new IntegrationError(
      "That address has no sign-in code. Copy the address your browser shows after you choose Allow.",
      400,
    );
  }
  return { code, state };
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function requestTokens(
  client: GoogleOauthClient,
  grant: Record<string, string>,
): Promise<GoogleTokens> {
  let response: Response;
  try {
    response = await fetch(endpoint("token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        ...grant,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new IntegrationError("Could not reach Google. Try again.", 502);
  }
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : "";
    if (error === "invalid_grant") {
      throw new IntegrationError(
        "Google no longer accepts this sign-in.",
        400,
        "invalid_grant",
      );
    }
    if (error === "invalid_client" || error === "unauthorized_client") {
      throw new IntegrationError(
        "Google rejected this server's client ID or secret. An administrator needs to check them.",
        502,
        "invalid_client",
      );
    }
    throw new IntegrationError(
      `Google refused the request${error ? ` (${error})` : ""}. Try again.`,
      502,
    );
  }
  if (
    typeof body.access_token !== "string" ||
    typeof body.expires_in !== "number"
  ) {
    throw new IntegrationError("Google sent an unexpected response.", 502);
  }
  return {
    accessToken: body.access_token,
    accessTokenExpiresAt: new Date(Date.now() + body.expires_in * 1000),
    refreshToken:
      typeof body.refresh_token === "string" ? body.refresh_token : null,
    scopes: typeof body.scope === "string" ? body.scope.split(" ") : [],
  };
}

export function exchangeAuthorizationCode(
  client: GoogleOauthClient,
  input: { code: string; codeVerifier: string },
): Promise<GoogleTokens> {
  return requestTokens(client, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: GOOGLE_REDIRECT_URI,
  });
}

export function refreshAccessToken(
  client: GoogleOauthClient,
  refreshToken: string,
): Promise<GoogleTokens> {
  return requestTokens(client, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** Withdraws a grant at Google. Failure is not reported: the token may already be dead. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(endpoint("revocation"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The connection is removed locally either way.
  }
}

export async function fetchGmailAddress(accessToken: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint("gmailProfile"), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new IntegrationError("Could not reach Gmail. Try again.", 502);
  }
  const body = (await response.json().catch(() => ({}))) as {
    emailAddress?: unknown;
  };
  if (!response.ok || typeof body.emailAddress !== "string") {
    throw new IntegrationError(
      response.status === 403
        ? "Gmail refused access. An administrator needs to check that the Gmail API is enabled for this server's Google project."
        : "Gmail did not return the account's address. Try again.",
      502,
    );
  }
  return body.emailAddress;
}

/** A Google account's own calendar is named by the account's address. */
export async function fetchCalendarAddress(accessToken: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint("primaryCalendar"), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new IntegrationError("Could not reach Google Calendar. Try again.", 502);
  }
  const body = (await response.json().catch(() => ({}))) as { id?: unknown };
  if (!response.ok || typeof body.id !== "string" || !body.id.includes("@")) {
    throw new IntegrationError(
      response.status === 403
        ? "Google Calendar refused access. An administrator needs to check that the Google Calendar API is enabled for this server's Google project."
        : "Google Calendar did not return the account's address. Try again.",
      502,
    );
  }
  return body.id;
}
