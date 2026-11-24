import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

/** Claims the provider asserts about whoever is "signed in" to it. */
export interface OidcTestUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export interface OidcTestProvider {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The person every authorization request signs in as; null refuses consent. */
  user: OidcTestUser | null;
  /** Redirect URIs authorization requests asked for, in order. */
  redirectUris: string[];
  close(): Promise<void>;
}

const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString("base64url");

/**
 * A small OpenID Connect provider for tests: discovery, signed ID tokens,
 * PKCE, and client authentication, with no login page. Whoever `user` names
 * is signed in at once, as when a real provider already has a session.
 */
export async function startOidcProvider(): Promise<OidcTestProvider> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const kid = "test-key";
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  const codes = new Map<
    string,
    { user: OidcTestUser; nonce: string | null; challenge: string | null; redirectUri: string }
  >();
  const tokens = new Map<string, OidcTestUser>();

  const provider: OidcTestProvider = {
    issuer: "",
    clientId: "overtchat-test",
    clientSecret: "test-client-secret",
    user: null,
    redirectUris: [],
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };

  function idToken(user: OidcTestUser, nonce: string | null): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
    const payload = base64url(
      JSON.stringify({
        iss: provider.issuer,
        aud: provider.clientId,
        iat: now,
        exp: now + 300,
        ...(nonce ? { nonce } : {}),
        ...user,
      }),
    );
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
    return `${header}.${payload}.${base64url(signature)}`;
  }

  function json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  async function body(req: http.IncomingMessage): Promise<URLSearchParams> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return new URLSearchParams(Buffer.concat(chunks).toString());
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", provider.issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer: provider.issuer,
        authorization_endpoint: `${provider.issuer}/authorize`,
        token_endpoint: `${provider.issuer}/token`,
        userinfo_endpoint: `${provider.issuer}/userinfo`,
        jwks_uri: `${provider.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return json(res, 200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      if (url.searchParams.get("client_id") !== provider.clientId || !redirectUri) {
        return json(res, 400, { error: "invalid_client" });
      }
      provider.redirectUris.push(redirectUri);
      const back = new URL(redirectUri);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (provider.user) {
        const code = randomBytes(16).toString("hex");
        codes.set(code, {
          user: provider.user,
          nonce: url.searchParams.get("nonce"),
          challenge: url.searchParams.get("code_challenge"),
          redirectUri,
        });
        back.searchParams.set("code", code);
      } else {
        back.searchParams.set("error", "access_denied");
      }
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const form = await body(req);
      const basic = req.headers.authorization?.startsWith("Basic ")
        ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":")
        : null;
      const clientId = basic?.[0] ?? form.get("client_id");
      const clientSecret = basic?.[1] ?? form.get("client_secret");
      if (
        decodeURIComponent(clientId ?? "") !== provider.clientId ||
        decodeURIComponent(clientSecret ?? "") !== provider.clientSecret
      ) {
        return json(res, 401, { error: "invalid_client" });
      }
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      if (
        !grant ||
        grant.redirectUri !== form.get("redirect_uri") ||
        (grant.challenge &&
          createHash("sha256").update(verifier).digest("base64url") !== grant.challenge)
      ) {
        return json(res, 400, { error: "invalid_grant" });
      }
      const accessToken = randomBytes(16).toString("hex");
      tokens.set(accessToken, grant.user);
      return json(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken(grant.user, grant.nonce),
      });
    }
    if (url.pathname === "/userinfo") {
      const user = tokens.get(req.headers.authorization?.replace(/^Bearer /u, "") ?? "");
      return user ? json(res, 200, user) : json(res, 401, { error: "invalid_token" });
    }
    json(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  provider.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return provider;
}
