import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { db as database } from "@/lib/db/client";

vi.mock("server-only", () => ({}));
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "overtchat-two-factor-"),
);
const baseURL = "http://localhost:4717";
const password = "original-password-123";
const managementSecret = "isolated-test-management-secret-123456";
vi.stubEnv("DATABASE_URL", path.join(directory, "chat.db"));
vi.stubEnv("BETTER_AUTH_URL", baseURL);
vi.stubEnv("BETTER_AUTH_SECRET", "isolated-auth-test-secret-1234567890123456");
vi.stubEnv("OVERTCHAT_MANAGEMENT_SECRET", managementSecret);
vi.stubEnv("OVERTCHAT_E2E_DISABLE_AUTH_RATE_LIMIT", "1");

let auth: (typeof import("./server"))["auth"];
let db: typeof database;
let policyGET: (typeof import("@/app/api/two-factor/route"))["GET"];
let managementPOST: (typeof import("@/app/api/internal/management/two-factor-reset/route"))["POST"];
type Login = { id: string; token: string; cookie: string };
let admin: Login;
let member: Login;

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((cookie) => !cookie.endsWith("="))
    .join("; ");
}

async function request(
  endpoint: string,
  body?: unknown,
  options: { cookie?: string; bearer?: string } = {},
) {
  return auth.handler(
    new Request(`${baseURL}/api/auth${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: baseURL,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.bearer
          ? { Authorization: `Bearer ${options.bearer}` }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function signIn(email: string): Promise<Login> {
  const response = await request("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.twoFactorRedirect).toBeUndefined();
  return { id: data.user.id, token: data.token, cookie: cookies(response) };
}

function totp(uri: string) {
  const secret = new URL(uri).searchParams.get("secret")!;
  return createOTP(new TextDecoder().decode(base32.decode(secret))).totp();
}

/** Sets up an authenticator for the login and returns its URI and backup codes. */
async function enroll(login: Login) {
  const enable = await request(
    "/two-factor/enable",
    { password },
    { cookie: login.cookie },
  );
  expect(enable.status).toBe(200);
  const { totpURI, backupCodes } = (await enable.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const verify = await request(
    "/two-factor/verify-totp",
    { code: await totp(totpURI) },
    { cookie: login.cookie },
  );
  expect(verify.status).toBe(200);
  login.cookie = cookies(verify);
  return { totpURI, backupCodes };
}

function twoFactorState(userId: string) {
  return {
    enabled: (
      db.$client
        .prepare("SELECT two_factor_enabled AS enabled FROM user WHERE id = ?")
        .get(userId) as { enabled: number }
    ).enabled,
    enrollments: (
      db.$client
        .prepare("SELECT count(*) AS n FROM two_factor WHERE user_id = ?")
        .get(userId) as { n: number }
    ).n,
    sessions: (
      db.$client
        .prepare("SELECT count(*) AS n FROM session WHERE user_id = ?")
        .get(userId) as { n: number }
    ).n,
  };
}

function policy(login: Login) {
  return policyGET(
    new Request(`${baseURL}/api/two-factor`, {
      headers: { Cookie: login.cookie },
    }),
  ).then((response) => response.json());
}

function managementReset(body: unknown, secret = managementSecret) {
  return managementPOST(
    new Request(`${baseURL}/api/internal/management/two-factor-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  db = (await import("@/lib/db/client")).db;
  (await import("@/lib/db/migrate")).runMigrations();
  auth = (await import("./server")).auth;
  policyGET = (await import("@/app/api/two-factor/route")).GET;
  managementPOST = (
    await import("@/app/api/internal/management/two-factor-reset/route")
  ).POST;
});

beforeEach(async () => {
  vi.stubEnv("OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR", "");
  db.$client.exec(
    "DELETE FROM user; DELETE FROM verification; DELETE FROM initial_setup;",
  );
  expect(
    (
      await request("/setup-admin", {
        code: (await import("@/lib/db/initialSetup")).getSetupCode(),
        email: "admin@example.com",
        name: "Admin",
        password,
      })
    ).status,
  ).toBe(200);
  admin = await signIn("admin@example.com");
  expect(
    (
      await request(
        "/admin/create-user",
        {
          email: "member@example.com",
          name: "Member",
          password,
          role: "user",
        },
        { cookie: admin.cookie },
      )
    ).status,
  ).toBe(200);
  member = await signIn("member@example.com");
});

afterAll(() => {
  db?.$client.close();
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("two-factor sign-in", () => {
  it("asks for a code after the password, then signs in", async () => {
    const { totpURI } = await enroll(member);
    expect(twoFactorState(member.id).enabled).toBe(1);

    const first = await request("/sign-in/email", {
      email: "member@example.com",
      password,
    });
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    // The bearer plugin still echoes the discarded password-only session.
    const discarded = first.headers.get("set-auth-token");
    if (discarded) {
      const session = await request("/get-session", undefined, {
        bearer: discarded,
      });
      expect(await session.json()).toBeNull();
    }
    const pending = cookies(first);
    expect(pending).toMatch(/better-auth\.two_factor=/);

    const wrong = await request(
      "/two-factor/verify-totp",
      { code: "000000" },
      { cookie: pending },
    );
    expect(wrong.status).toBe(401);

    const verified = await request(
      "/two-factor/verify-totp",
      { code: await totp(totpURI) },
      { cookie: pending },
    );
    expect(verified.status).toBe(200);
    const session = await request("/get-session", undefined, {
      cookie: cookies(verified),
    });
    expect((await session.json()).user.email).toBe("member@example.com");
  });

  it("returns a bearer token to clients that forward the pending cookie", async () => {
    const { totpURI } = await enroll(member);
    const first = await request("/sign-in/email", {
      email: "member@example.com",
      password,
    });
    // Like the desktop app: the discarded bearer token rides along.
    const verified = await request(
      "/two-factor/verify-totp",
      { code: await totp(totpURI) },
      {
        cookie: cookies(first),
        bearer: first.headers.get("set-auth-token") ?? undefined,
      },
    );
    expect(verified.status).toBe(200);
    const token = verified.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    const session = await request("/get-session", undefined, {
      bearer: token!,
    });
    expect((await session.json()).user.email).toBe("member@example.com");
  });

  it("accepts each backup code once", async () => {
    const { backupCodes } = await enroll(member);
    const use = async () => {
      const first = await request("/sign-in/email", {
        email: "member@example.com",
        password,
      });
      return request(
        "/two-factor/verify-backup-code",
        { code: backupCodes[0] },
        { cookie: cookies(first) },
      );
    };
    expect((await use()).status).toBe(200);
    expect((await use()).status).toBe(401);
  });
});

describe("administrator two-factor reset", () => {
  it.each(["anonymous", "member", "self", "wrong-password"])(
    "rejects %s without changing anything",
    async (scenario) => {
      await enroll(member);
      await enroll(admin);
      const before = twoFactorState(member.id);
      const response = await request(
        "/admin/reset-user-two-factor",
        {
          userId: scenario === "self" ? admin.id : member.id,
          currentPassword:
            scenario === "wrong-password" ? "wrong-password" : password,
        },
        scenario === "anonymous"
          ? {}
          : { cookie: scenario === "member" ? member.cookie : admin.cookie },
      );
      expect(response.status).toBe(
        scenario === "anonymous" ? 401 : scenario === "member" ? 403 : 400,
      );
      expect(twoFactorState(member.id)).toEqual(before);
      expect(twoFactorState(admin.id).enabled).toBe(1);
    },
  );

  it("removes the authenticator and signs the user out everywhere", async () => {
    await enroll(member);
    const response = await request(
      "/admin/reset-user-two-factor",
      { userId: member.id, currentPassword: password },
      { cookie: admin.cookie },
    );
    expect(response.status).toBe(200);
    expect(twoFactorState(member.id)).toEqual({
      enabled: 0,
      enrollments: 0,
      sessions: 0,
    });
    await signIn("member@example.com");
  });

  it("reports users without two-factor", async () => {
    const response = await request(
      "/admin/reset-user-two-factor",
      { userId: member.id, currentPassword: password },
      { cookie: admin.cookie },
    );
    expect(response.status).toBe(409);
  });
});

describe("operator two-factor reset", () => {
  it("requires the management secret", async () => {
    await enroll(admin);
    const response = await managementReset(
      { email: "admin@example.com" },
      "wrong-secret-wrong-secret-wrong-secret",
    );
    expect(response.status).toBe(401);
    expect(twoFactorState(admin.id).enabled).toBe(1);
  });

  it("recovers an administrator who lost their authenticator", async () => {
    await enroll(admin);
    const response = await managementReset({ email: "Admin@Example.com" });
    expect(response.status).toBe(200);
    expect(twoFactorState(admin.id)).toEqual({
      enabled: 0,
      enrollments: 0,
      sessions: 0,
    });
    await signIn("admin@example.com");
  });

  it.each([
    [{ email: "missing@example.com" }, 404],
    [{ email: "member@example.com" }, 409],
    [{ email: "not-an-email" }, 400],
  ])("rejects %o with %i", async (body, status) => {
    expect((await managementReset(body)).status).toBe(status);
  });
});

describe("administrator requirement", () => {
  it("is off unless the server sets it", async () => {
    expect(await policy(admin)).toEqual({ enabled: false, required: false });
  });

  it("applies to administrators only", async () => {
    vi.stubEnv("OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR", "true");
    expect(await policy(admin)).toEqual({ enabled: false, required: true });
    expect(await policy(member)).toEqual({ enabled: false, required: false });
  });

  it("keeps required administrators from turning two-factor off", async () => {
    await enroll(admin);
    await enroll(member);
    vi.stubEnv("OVERTCHAT_REQUIRE_ADMIN_TWO_FACTOR", "true");
    expect(await policy(admin)).toEqual({ enabled: true, required: true });
    const refused = await request(
      "/two-factor/disable",
      { password },
      { cookie: admin.cookie },
    );
    expect(refused.status).toBe(403);
    expect(twoFactorState(admin.id).enabled).toBe(1);
    const allowed = await request(
      "/two-factor/disable",
      { password },
      { cookie: member.cookie },
    );
    expect(allowed.status).toBe(200);
    expect(twoFactorState(member.id).enabled).toBe(0);
  });
});
