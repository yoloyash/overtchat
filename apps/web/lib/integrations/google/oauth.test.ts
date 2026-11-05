import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { IntegrationError } from "@/lib/integrations/errors";
import {
  GOOGLE_REDIRECT_URI,
  createAuthorizationSecrets,
  exchangeAuthorizationCode,
  fetchGmailAddress,
  googleAuthorizationUrl,
  parseAuthorizationResponse,
  refreshAccessToken,
} from "./oauth";

const client = { clientId: "client-1", clientSecret: "secret-1" };

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("authorization URL", () => {
  it("asks for a lasting, PKCE-bound grant on the loopback redirect", () => {
    const secrets = createAuthorizationSecrets();
    const url = new URL(
      googleAuthorizationUrl({
        clientId: "client-1",
        scopes: ["scope-a", "scope-b"],
        ...secrets,
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "scope-a scope-b",
      state: secrets.state,
      code_challenge: createHash("sha256")
        .update(secrets.codeVerifier)
        .digest("base64url"),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });
  });

  it("never repeats its secrets", () => {
    const first = createAuthorizationSecrets();
    const second = createAuthorizationSecrets();
    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});

describe("pasted browser address", () => {
  it("yields the code and state", () => {
    expect(
      parseAuthorizationResponse(
        "  http://localhost:1/?state=abc&code=4/0Ab-cd&scope=x%20y  ",
      ),
    ).toEqual({ code: "4/0Ab-cd", state: "abc" });
  });

  it.each([
    ["not an address", /not the address from your browser/],
    ["http://localhost:1/?state=abc", /no sign-in code/],
    ["http://localhost:1/?code=abc", /no sign-in code/],
    ["http://localhost:1/?error=access_denied&state=abc", /choose Allow/],
    ["http://localhost:1/?error=server_error", /server_error/],
  ])("explains what is wrong with %s", (input, message) => {
    expect(() => parseAuthorizationResponse(input)).toThrow(message);
  });
});

describe("token requests", () => {
  it("exchanges a code with the verifier and reads the grant", async () => {
    const fetchMock = respond(200, {
      access_token: "access",
      expires_in: 3600,
      refresh_token: "refresh",
      scope: "scope-a scope-b",
    });
    const before = Date.now();

    const tokens = await exchangeAuthorizationCode(client, {
      code: "the-code",
      codeVerifier: "the-verifier",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(init!.body as URLSearchParams)).toEqual({
      client_id: "client-1",
      client_secret: "secret-1",
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: "the-verifier",
      redirect_uri: GOOGLE_REDIRECT_URI,
    });
    expect(tokens).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      scopes: ["scope-a", "scope-b"],
    });
    expect(tokens.accessTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
  });

  it("refreshes without expecting a new refresh token", async () => {
    const fetchMock = respond(200, { access_token: "access", expires_in: 60 });

    const tokens = await refreshAccessToken(client, "refresh");

    expect(
      Object.fromEntries(fetchMock.mock.calls[0][1]!.body as URLSearchParams),
    ).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh" });
    expect(tokens.refreshToken).toBeNull();
  });

  it("marks a withdrawn grant so callers can ask for a new sign-in", async () => {
    respond(400, { error: "invalid_grant" });
    await expect(refreshAccessToken(client, "refresh")).rejects.toMatchObject({
      code: "invalid_grant",
      status: 400,
    });
  });

  it("points an administrator at a rejected client", async () => {
    respond(401, { error: "invalid_client" });
    await expect(refreshAccessToken(client, "refresh")).rejects.toMatchObject({
      code: "invalid_client",
      status: 502,
      message: expect.stringContaining("administrator"),
    });
  });

  it("reports an unreachable or malformed Google as a gateway failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(refreshAccessToken(client, "refresh")).rejects.toMatchObject({
      status: 502,
    });

    vi.restoreAllMocks();
    respond(200, { access_token: "access" });
    await expect(refreshAccessToken(client, "refresh")).rejects.toBeInstanceOf(
      IntegrationError,
    );
  });
});

describe("account address", () => {
  it("reads the mailbox address with the access token", async () => {
    const fetchMock = respond(200, { emailAddress: "ada@example.test" });

    await expect(fetchGmailAddress("access")).resolves.toBe("ada@example.test");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer access" },
    });
  });

  it("tells an administrator when the Gmail API is not enabled", async () => {
    respond(403, { error: { status: "PERMISSION_DENIED" } });
    await expect(fetchGmailAddress("access")).rejects.toThrow(/Gmail API/);
  });
});
