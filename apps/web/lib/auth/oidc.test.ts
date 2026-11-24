import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  MOBILE_SIGN_IN_REDIRECT,
  TWO_FACTOR_CLIENT_HEADER,
  desktopSignInRedirect,
  nativeSignInStartUrl,
  type SignInMethods,
  type TwoFactorStatus,
} from "@overtchat/shared";
import { startOidcProvider, type OidcTestProvider } from "./fixtures/oidc-provider";
import { oidcDiscoveryUrl, readOidcConfig } from "./oidc";

vi.mock("server-only", () => ({}));

const baseURL = "http://localhost:4717";
const password = "original-password-123";
const directories: string[] = [];
let provider: OidcTestProvider;

/** A browser or app: the cookies it holds between requests. */
class Jar {
  private readonly cookies = new Map<string, string>();

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  store(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const name = pair.slice(0, pair.indexOf("=")).trim();
      const value = pair.slice(pair.indexOf("=") + 1);
      const expired = attributes.some((attribute) => /^\s*max-age=0$/iu.test(attribute));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

type Server = Awaited<ReturnType<typeof boot>>;

/** Starts the app's auth with its own database and the given OIDC settings. */
async function boot(env: Record<string, string> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-oidc-"));
  directories.push(directory);
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", path.join(directory, "chat.db"));
  vi.stubEnv("BETTER_AUTH_URL", baseURL);
  vi.stubEnv("BETTER_AUTH_SECRET", "isolated-auth-test-secret-1234567890123456");
  vi.stubEnv("OVERTCHAT_E2E_DISABLE_AUTH_RATE_LIMIT", "1");
  vi.stubEnv("OIDC_ISSUER_URL", provider.issuer);
  vi.stubEnv("OIDC_CLIENT_ID", provider.clientId);
  vi.stubEnv("OIDC_CLIENT_SECRET", provider.clientSecret);
  vi.stubEnv("OIDC_PROVIDER_NAME", "Test ID");
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

  const { db } = await import("@/lib/db/client");
  (await import("@/lib/db/migrate")).runMigrations();
  const { auth } = await import("./server");
  const routes = {
    methods: (await import("@/app/api/sign-in-methods/route")).GET,
    start: (await import("@/app/api/native-sign-in/start/route")).GET,
    finish: (await import("@/app/api/native-sign-in/finish/route")).GET,
    twoFactor: (await import("@/app/api/two-factor/route")).GET,
  };

  async function api(endpoint: string, body?: unknown, jar?: Jar) {
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth${endpoint}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: baseURL,
          [TWO_FACTOR_CLIENT_HEADER]: "1",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(jar?.header() ? { Cookie: jar.header() } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    jar?.store(response);
    return response;
  }

  const setup = await api("/setup-admin", {
    code: (await import("@/lib/db/initialSetup")).getSetupCode(),
    email: "admin@example.com",
    name: "Admin",
    password,
  });
  expect(setup.status).toBe(200);
  const admin = new Jar();
  admin.store(setup);

  /** Follows the redirect to the provider and back to the app's callback. */
  async function throughProvider(authorizationUrl: string, jar: Jar) {
    const atProvider = await fetch(authorizationUrl, { redirect: "manual" });
    expect(atProvider.status).toBe(302);
    const callback = new URL(atProvider.headers.get("location")!);
    expect(callback.origin + callback.pathname).toBe(
      `${baseURL}/api/auth/callback/oidc`,
    );
    const response = await api(
      callback.pathname.replace("/api/auth", "") + callback.search,
      undefined,
      jar,
    );
    expect(response.status).toBe(302);
    return new URL(response.headers.get("location")!, baseURL);
  }

  /** Signs in on the web; returns where the browser lands. */
  async function webSignIn(jar = new Jar()) {
    const started = await api(
      "/sign-in/social",
      { provider: "oidc", callbackURL: "/", errorCallbackURL: "/login" },
      jar,
    );
    expect(started.status).toBe(200);
    const { url } = (await started.json()) as { url: string };
    return { jar, landed: await throughProvider(url, jar) };
  }

  async function sessionUser(jar: Jar) {
    const response = await api("/get-session", undefined, jar);
    const data = (await response.json()) as {
      user: { id: string; email: string; role: string; name: string };
    } | null;
    return data?.user ?? null;
  }

  /**
   * An app's sign-in: `browser` is the system browser it opens. Returns the
   * redirect the app receives.
   */
  async function nativeSignIn(
    browser: Jar,
    redirectUri: string,
    verifier = "v".repeat(64),
    state = "state-1234567890abcdef",
  ) {
    const startUrl = nativeSignInStartUrl(baseURL, {
      redirectUri,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      state,
    });
    const started = await routes.start(
      new Request(startUrl, { headers: { Cookie: browser.header() } }),
    );
    browser.store(started);
    if (started.status !== 302) return { started, redirect: null };
    const finishUrl = await throughProvider(started.headers.get("location")!, browser);
    expect(finishUrl.pathname).toBe("/api/native-sign-in/finish");
    const finished = await routes.finish(
      new Request(finishUrl, { headers: { Cookie: browser.header() } }),
    );
    browser.store(finished);
    expect(finished.status).toBe(302);
    return {
      started,
      finishUrl,
      redirect: new URL(finished.headers.get("location")!),
    };
  }

  function exchange(code: string, codeVerifier = "v".repeat(64), app?: Jar) {
    return api("/native-sign-in/exchange", { code, codeVerifier }, app);
  }

  return {
    auth,
    db,
    routes,
    api,
    admin,
    webSignIn,
    sessionUser,
    nativeSignIn,
    exchange,
    close: () => db.$client.close(),
  };
}

let server: Server | undefined;

beforeAll(async () => {
  provider = await startOidcProvider();
});

afterEach(() => {
  server?.close();
  server = undefined;
  provider.user = null;
  provider.redirectUris.length = 0;
});

afterAll(async () => {
  await provider.close();
  vi.unstubAllEnvs();
  for (const directory of directories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("OIDC configuration", () => {
  it("accepts an issuer or its discovery document", () => {
    const discovery = "https://id.example.com/.well-known/openid-configuration";
    expect(oidcDiscoveryUrl("https://id.example.com")).toBe(discovery);
    expect(oidcDiscoveryUrl("https://id.example.com/")).toBe(discovery);
    expect(oidcDiscoveryUrl(discovery)).toBe(discovery);
    expect(oidcDiscoveryUrl("https://id.example.com/realms/home/")).toBe(
      "https://id.example.com/realms/home/.well-known/openid-configuration",
    );
    expect(oidcDiscoveryUrl("id.example.com")).toBeNull();
    expect(oidcDiscoveryUrl("ftp://id.example.com")).toBeNull();
  });

  it("stays off, and says why, when only part of it is set", () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);

    expect(readOidcConfig({}, warn)).toBeNull();
    expect(warnings).toEqual([]);

    expect(
      readOidcConfig({ OIDC_ISSUER_URL: "https://id.example.com" }, warn),
    ).toBeNull();
    expect(warnings[0]).toContain("OIDC_CLIENT_ID, OIDC_CLIENT_SECRET");

    expect(
      readOidcConfig(
        {
          OIDC_ISSUER_URL: "https://id.example.com",
          OIDC_CLIENT_ID: "overtchat",
          OIDC_CLIENT_SECRET: "secret",
          OIDC_AUTO_CREATE_USERS: "true",
        },
        warn,
      ),
    ).toEqual({
      name: "SSO",
      discoveryUrl: "https://id.example.com/.well-known/openid-configuration",
      clientId: "overtchat",
      clientSecret: "secret",
      autoCreateUsers: true,
    });
  });

  it("keeps passwords on when single sign-on isn't configured", async () => {
    server = await boot({
      OIDC_CLIENT_SECRET: "",
      OIDC_DISABLE_PASSWORD_LOGIN: "true",
    });

    const methods = (await server.routes.methods().json()) as SignInMethods;
    expect(methods).toEqual({ password: true, sso: null });
    const signedIn = await server.api("/sign-in/email", {
      email: "admin@example.com",
      password,
    });
    expect(signedIn.status).toBe(200);
  });
});

describe("signing in with the identity provider", () => {
  it("signs an existing account in by its email, then by the provider's ID", async () => {
    server = await boot();
    expect(await server.routes.methods().json()).toEqual({
      password: true,
      sso: { name: "Test ID" },
    });

    // Many providers don't report the email as verified at all.
    provider.user = { sub: "idp-admin", email: "Admin@Example.com", name: "Ada" };
    const first = await server.webSignIn();
    expect(first.landed.pathname + first.landed.search).toBe("/");
    expect(provider.redirectUris).toEqual([`${baseURL}/api/auth/callback/oidc`]);
    const user = await server.sessionUser(first.jar);
    expect(user).toMatchObject({ email: "admin@example.com", role: "admin", name: "Admin" });

    // The email changing at the provider doesn't move the account.
    provider.user = { sub: "idp-admin", email: "renamed@example.com" };
    const second = await server.webSignIn();
    expect(second.landed.pathname + second.landed.search).toBe("/");
    expect(await server.sessionUser(second.jar)).toMatchObject({
      id: user!.id,
      email: "admin@example.com",
    });
  });

  it("refuses someone without an account, and creates none", async () => {
    server = await boot();
    provider.user = { sub: "idp-stranger", email: "stranger@example.com" };

    const { jar, landed } = await server.webSignIn();

    expect(landed.pathname).toBe("/login");
    expect(landed.searchParams.get("error")).toBe("signup_disabled");
    expect(await server.sessionUser(jar)).toBeNull();
    expect(
      server.db.$client.prepare("SELECT count(*) AS n FROM user").get(),
    ).toEqual({ n: 1 });
  });

  it("reports a sign-in abandoned at the provider", async () => {
    server = await boot();
    provider.user = null;

    const { jar, landed } = await server.webSignIn();

    expect(landed.pathname).toBe("/login");
    expect(landed.searchParams.get("error")).toBe("access_denied");
    expect(await server.sessionUser(jar)).toBeNull();
  });

  it("creates the account on a first sign-in when the operator allows it", async () => {
    server = await boot({ OIDC_AUTO_CREATE_USERS: "true" });
    provider.user = { sub: "idp-new", email: "New@Example.com", name: "New Person" };

    const { jar, landed } = await server.webSignIn();

    expect(landed.pathname + landed.search).toBe("/");
    expect(await server.sessionUser(jar)).toMatchObject({
      email: "new@example.com",
      name: "New Person",
      role: "user",
    });
    // They have no password, so there is none to protect with two-factor.
    const status = (await (
      await server.routes.twoFactor(
        new Request(`${baseURL}/api/two-factor`, { headers: { Cookie: jar.header() } }),
      )
    ).json()) as TwoFactorStatus;
    expect(status).toEqual({ enabled: false, required: false, passwordSignIn: false });

    // Public sign-up stays closed.
    const signedUp = await server.api("/sign-up/email", {
      email: "other@example.com",
      name: "Other",
      password,
    });
    expect(signedUp.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a disabled account", async () => {
    server = await boot({ OIDC_AUTO_CREATE_USERS: "true" });
    provider.user = { sub: "idp-member", email: "member@example.com" };
    const first = await server.webSignIn();
    const member = await server.sessionUser(first.jar);
    const banned = await server.api("/admin/ban-user", { userId: member!.id }, server.admin);
    expect(banned.status).toBe(200);

    const { jar, landed } = await server.webSignIn();

    expect(landed.pathname).toBe("/login");
    expect(landed.searchParams.get("error")).toBeTruthy();
    expect(await server.sessionUser(jar)).toBeNull();
  });
});

describe("turning password sign-in off", () => {
  it("refuses a correct password and still signs in through the provider", async () => {
    server = await boot({ OIDC_DISABLE_PASSWORD_LOGIN: "true" });
    expect(await server.routes.methods().json()).toEqual({
      password: false,
      sso: { name: "Test ID" },
    });

    const refused = await server.api("/sign-in/email", {
      email: "admin@example.com",
      password,
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "PASSWORD_LOGIN_DISABLED" });

    provider.user = { sub: "idp-admin", email: "admin@example.com" };
    const { jar, landed } = await server.webSignIn();
    expect(landed.pathname + landed.search).toBe("/");

    // An administrator can't be made to set up a factor nothing would ask for.
    vi.stubEnv("OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR", "true");
    const status = (await (
      await server.routes.twoFactor(
        new Request(`${baseURL}/api/two-factor`, { headers: { Cookie: jar.header() } }),
      )
    ).json()) as TwoFactorStatus;
    expect(status).toEqual({ enabled: false, required: false, passwordSignIn: false });
  });
});

describe("signing an app in through the system browser", () => {
  it("hands the desktop app a session of its own and leaves the browser signed out", async () => {
    server = await boot();
    provider.user = { sub: "idp-admin", email: "admin@example.com" };
    const browser = new Jar();
    const redirectUri = desktopSignInRedirect(51234);

    const { redirect } = await server.nativeSignIn(browser, redirectUri);

    expect(redirect!.origin + redirect!.pathname).toBe(redirectUri);
    expect(redirect!.searchParams.get("state")).toBe("state-1234567890abcdef");
    const code = redirect!.searchParams.get("code")!;
    expect(code).toBeTruthy();
    expect(await server.sessionUser(browser)).toBeNull();

    const app = new Jar();
    const exchanged = await server.exchange(code, undefined, app);
    expect(exchanged.status).toBe(200);
    // The desktop app keeps this token; the mobile app keeps the cookie.
    expect(exchanged.headers.get("set-auth-token")).toBeTruthy();
    expect(await server.sessionUser(app)).toMatchObject({ email: "admin@example.com" });

    // A code works once.
    expect((await server.exchange(code)).status).toBe(400);
  });

  it("signs the mobile app in at its own scheme", async () => {
    server = await boot();
    provider.user = { sub: "idp-admin", email: "admin@example.com" };

    const { redirect } = await server.nativeSignIn(new Jar(), MOBILE_SIGN_IN_REDIRECT);

    expect(redirect!.protocol).toBe("overtchat:");
    expect(redirect!.host).toBe("login");
    const app = new Jar();
    expect(
      (await server.exchange(redirect!.searchParams.get("code")!, undefined, app)).status,
    ).toBe(200);
    expect(await server.sessionUser(app)).toMatchObject({ role: "admin" });
  });

  it("leaves a browser that was already signed in as it was", async () => {
    server = await boot();
    provider.user = { sub: "idp-admin", email: "admin@example.com" };
    const browser = server.admin;

    const { redirect } = await server.nativeSignIn(browser, desktopSignInRedirect(51234));

    expect(redirect!.searchParams.get("code")).toBeTruthy();
    expect(await server.sessionUser(browser)).toMatchObject({ email: "admin@example.com" });
  });

  it("gives a code only to the app that started the sign-in", async () => {
    server = await boot();
    provider.user = { sub: "idp-admin", email: "admin@example.com" };
    const { redirect } = await server.nativeSignIn(
      new Jar(),
      desktopSignInRedirect(51234),
    );
    const code = redirect!.searchParams.get("code")!;

    const stolen = await server.exchange(code, "x".repeat(64));

    expect(stolen.status).toBe(400);
    // The attempt spends the code, so it can't be tried again.
    expect((await server.exchange(code)).status).toBe(400);
  });

  it("returns the provider's refusal to the app", async () => {
    server = await boot();
    provider.user = { sub: "idp-stranger", email: "stranger@example.com" };
    const browser = new Jar();

    const { redirect } = await server.nativeSignIn(browser, MOBILE_SIGN_IN_REDIRECT);

    expect(redirect!.searchParams.get("error")).toBe("signup_disabled");
    expect(redirect!.searchParams.get("code")).toBeNull();
    expect(redirect!.searchParams.get("state")).toBe("state-1234567890abcdef");
  });

  it("never issues a code for a sign-in the browser already had", async () => {
    server = await boot();
    provider.user = { sub: "idp-admin", email: "admin@example.com" };
    const browser = server.admin;
    const first = await server.nativeSignIn(browser, MOBILE_SIGN_IN_REDIRECT);
    expect(first.redirect!.searchParams.get("code")).toBeTruthy();

    // The same link again, as a page the user was sent to might try.
    const replayed = await server.routes.finish(
      new Request(first.finishUrl!, { headers: { Cookie: browser.header() } }),
    );

    expect(replayed.status).toBe(400);
    expect(replayed.headers.get("location")).toBeNull();
  });

  it("doesn't take a browser's earlier sign-in for the app's", async () => {
    server = await boot();
    const { createNativeSignInRequest } = await import("@/lib/db/nativeSignIn");
    // The browser signed in a moment ago; the app's sign-in starts later and
    // comes back without the provider having signed anyone in.
    const request = createNativeSignInRequest(
      {
        redirectUri: MOBILE_SIGN_IN_REDIRECT,
        codeChallenge: "c".repeat(43),
        state: "state-1234567890abcdef",
        browserSignedIn: true,
      },
      new Date(Date.now() + 60_000),
    );

    const finished = await server.routes.finish(
      new Request(`${baseURL}/api/native-sign-in/finish?request=${request}`, {
        headers: { Cookie: server.admin.header() },
      }),
    );

    const redirect = new URL(finished.headers.get("location")!);
    expect(redirect.searchParams.get("error")).toBe("sign_in_failed");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("refuses to send a code anywhere but an app", async () => {
    server = await boot();
    provider.user = { sub: "idp-admin", email: "admin@example.com" };

    for (const redirectUri of [
      "https://evil.example.com/sign-in",
      "http://127.0.0.1.evil.example.com:51234/sign-in",
      "http://localhost:51234/sign-in",
      "http://127.0.0.1:51234/other",
      "overtchat://login?next=evil",
      "evil://login",
    ]) {
      const { started } = await server.nativeSignIn(new Jar(), redirectUri);
      expect(started.status, redirectUri).toBe(400);
    }
    expect(provider.redirectUris).toEqual([]);
  });

  it("has nothing to offer when single sign-on is off", async () => {
    server = await boot({ OIDC_ISSUER_URL: "", OIDC_CLIENT_ID: "", OIDC_CLIENT_SECRET: "" });

    const { started } = await server.nativeSignIn(new Jar(), MOBILE_SIGN_IN_REDIRECT);

    expect(started.status).toBe(404);
  });
});
