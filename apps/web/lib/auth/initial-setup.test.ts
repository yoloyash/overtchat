import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-setup-"));
const baseURL = "http://localhost:4717";
const secret = "setup-test-management-secret-1234567890";
vi.stubEnv("DATABASE_URL", path.join(directory, "chat.db"));
vi.stubEnv("BETTER_AUTH_URL", baseURL);
vi.stubEnv("BETTER_AUTH_SECRET", "setup-test-auth-secret-1234567890123456");
vi.stubEnv("OVERTCHAT_MANAGEMENT_SECRET", secret);
vi.stubEnv("OVERTCHAT_E2E_DISABLE_AUTH_RATE_LIMIT", "1");
let auth: (typeof import("./server"))["auth"];
let db: (typeof import("@/lib/db/client"))["db"];
let setup: typeof import("@/lib/db/initialSetup");
let management: typeof import("@/app/api/internal/management/setup/route");
let publicSetup: typeof import("@/app/api/setup/route");
const body = { name: "Owner", email: "owner@example.com", password: "test-password-123" };

function request(endpoint: string, data: unknown, token?: string) {
  return auth.handler(new Request(`${baseURL}/api/auth${endpoint}`, {
    method: "POST", headers: {
      Origin: baseURL, "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify(data),
  }));
}
function operator(token = secret) {
  return management.GET(new Request(`${baseURL}/api/internal/management/setup`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
}
beforeAll(async () => {
  db = (await import("@/lib/db/client")).db;
  (await import("@/lib/db/migrate")).runMigrations();
  setup = await import("@/lib/db/initialSetup");
  auth = (await import("./server")).auth;
  management = await import("@/app/api/internal/management/setup/route");
  publicSetup = await import("@/app/api/setup/route");
});
beforeEach(() => {
  db.$client.exec("DELETE FROM host_connectors; DELETE FROM user; DELETE FROM initial_setup;");
});
afterAll(() => {
  db?.$client.close();
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("exposes only setup state publicly and requires the management credential for retrieval", async () => {
  expect((await operator("")).status).toBe(401);
  expect((await operator("a-user-session-token")).status).toBe(401);
  const response = await operator();
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result).toEqual({ required: true, code: setup.getSetupCode() });
  expect(result.code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){2}$/);
  expect(await (await publicSetup.GET()).json()).toEqual({ required: true });
  vi.stubEnv("OVERTCHAT_MANAGEMENT_SECRET", "");
  expect((await operator()).status).toBe(401);
  vi.stubEnv("OVERTCHAT_MANAGEMENT_SECRET", secret);
});

it("keeps the code stable across module/database reopen without storing it", async () => {
  const code = setup.getSetupCode();
  expect(JSON.stringify(db.$client.prepare("SELECT * FROM initial_setup").all())).not.toContain(code);
  vi.resetModules();
  const reopened = await import("@/lib/db/initialSetup");
  expect(reopened.getSetupCode()).toBe(code);
  (await import("@/lib/db/client")).db.$client.close();
});

it("rejects missing/wrong codes and the old public signup path", async () => {
  for (const code of [undefined, "WRONG-CODE-0000"]) {
    expect((await request("/setup-admin", { ...body, code })).status).toBe(400);
  }
  expect((await request("/sign-up/email", { ...body, code: setup.getSetupCode() })).status).toBe(400);
  expect(db.$client.prepare("SELECT count(*) AS n FROM user").get()).toEqual({ n: 0 });
});

it("claims the connector, signs in, closes setup, and preserves admin-created users", async () => {
  db.$client.prepare("INSERT INTO host_connectors (id, name, token_hash, managed, created_at, updated_at) VALUES ('managed', 'Host', 'hash', 1, 1, 1)").run();
  const code = setup.getSetupCode()!;
  const response = await request("/setup-admin", { ...body, code: code.toLowerCase().replaceAll("-", " ") });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("session_token");
  const result = await response.json();
  expect(result.user.role).toBe("admin");
  const desktopToken = response.headers.get("set-auth-token");
  expect(desktopToken).toBeTruthy();
  const desktopSession = await auth.handler(new Request(`${baseURL}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${desktopToken}` },
  }));
  expect((await desktopSession.json()).user.id).toBe(result.user.id);
  expect(db.$client.prepare("SELECT user_id FROM host_connectors").get()).toEqual({ user_id: result.user.id });
  expect(await (await operator()).json()).toEqual({ required: false, code: null });
  expect(await (await publicSetup.GET()).json()).toEqual({ required: false });
  expect((await request("/setup-admin", { ...body, email: "second@example.com", code })).status).toBe(400);
  expect((await request("/sign-in/email", body)).status).toBe(200);
  expect((await request("/admin/create-user", {
    ...body, email: "member@example.com", role: "user",
  }, result.token)).status).toBe(200);
  db.$client.exec("DELETE FROM user;");
  expect(setup.getSetupCode()).toBeNull();
});

it("allows only one concurrent claim", async () => {
  const code = setup.getSetupCode();
  const responses = await Promise.all(["a", "b"].map((name) => request("/setup-admin", {
    ...body, code, email: `${name}@example.com`,
  })));
  expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
  expect(db.$client.prepare("SELECT count(*) AS n FROM user").get()).toEqual({ n: 1 });
  expect(db.$client.prepare("SELECT count(*) AS n FROM account").get()).toEqual({ n: 1 });
});

it("rolls back a failed credential write and allows retry with the same code", async () => {
  const code = setup.getSetupCode();
  db.$client.exec("CREATE TRIGGER fail_setup BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  try {
    expect((await request("/setup-admin", { ...body, code })).status).toBe(500);
    expect(db.$client.prepare("SELECT count(*) AS n FROM user").get()).toEqual({ n: 0 });
    expect(setup.getSetupCode()).toBe(code);
  } finally {
    db.$client.exec("DROP TRIGGER fail_setup;");
  }
  expect((await request("/setup-admin", { ...body, code })).status).toBe(200);
});

it("does not consume the code on invalid account input", async () => {
  const code = setup.getSetupCode();
  expect((await request("/setup-admin", { ...body, code, password: "short" })).status).toBe(400);
  expect(setup.getSetupCode()).toBe(code);
  expect((await request("/setup-admin", { ...body, code })).status).toBe(200);
});

it("closes setup on upgrade even when existing users have no admin", async () => {
  db.$client.prepare("INSERT INTO user (id, name, email, role) VALUES ('old', 'Old', 'old@example.com', 'user')").run();
  expect(setup.getSetupCode()).toBeNull();
  db.$client.exec("DELETE FROM user;");
  expect(setup.getSetupCode()).toBeNull();
});

it("rate limits setup-code guesses", async () => {
  const context = await auth.$context;
  const previous = context.rateLimit.enabled;
  context.rateLimit.enabled = true;
  try {
    for (let i = 0; i < 5; i++)
      expect((await request("/setup-admin", { ...body, code: "wrong" })).status).toBe(400);
    expect((await request("/setup-admin", { ...body, code: setup.getSetupCode() })).status).toBe(429);
  } finally {
    context.rateLimit.enabled = previous;
  }
});

it("rejects setup from an untrusted browser origin", async () => {
  const context = await auth.$context;
  const previous = context.skipOriginCheck;
  // Better Auth disables origin checks under NODE_ENV=test by default.
  context.skipOriginCheck = false;
  try {
    const response = await auth.handler(new Request(`${baseURL}/api/auth/setup-admin`, {
      method: "POST",
      headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, code: setup.getSetupCode() }),
    }));
    expect(response.status).toBe(403);
    expect(db.$client.prepare("SELECT count(*) AS n FROM user").get()).toEqual({ n: 0 });
  } finally {
    context.skipOriginCheck = previous;
  }
});

it("preserves a usable account if automatic sign-in fails after the claim", async () => {
  db.$client.exec("CREATE TRIGGER fail_setup_session BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  try {
    const response = await request("/setup-admin", { ...body, code: setup.getSetupCode() });
    expect(response.status).toBe(200);
    expect((await response.json()).token).toBeNull();
    expect(setup.getSetupCode()).toBeNull();
  } finally {
    db.$client.exec("DROP TRIGGER fail_setup_session;");
  }
  expect((await request("/sign-in/email", body)).status).toBe(200);
});
