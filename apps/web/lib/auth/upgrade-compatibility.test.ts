import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import fixture from "./fixtures/better-auth-1.6.23.json";

vi.mock("server-only", () => ({}));
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "overtchat-auth-upgrade-"),
);
const baseURL = "http://localhost:4717";
vi.stubEnv("DATABASE_URL", path.join(directory, "chat.db"));
vi.stubEnv("BETTER_AUTH_URL", baseURL);
vi.stubEnv("BETTER_AUTH_SECRET", fixture.secret);
vi.stubEnv("EXTRA_TRUSTED_ORIGINS", "overtchat://app");
vi.stubEnv("OVERTCHAT_E2E_DISABLE_AUTH_RATE_LIMIT", "1");
let auth: (typeof import("./server"))["auth"];
let db: (typeof import("@/lib/db/client"))["db"];

beforeAll(async () => {
  db = (await import("@/lib/db/client")).db;
  (await import("@/lib/db/migrate")).runMigrations();
  auth = (await import("./server")).auth;
});
beforeEach(async () => {
  const { user, account, session } = await import("@/lib/db/schema");
  db.$client.exec("DELETE FROM user; DELETE FROM verification;");
  const dates = {
    createdAt: new Date(fixture.user.createdAt),
    updatedAt: new Date(),
  };
  db.insert(user)
    .values({ ...fixture.user, ...dates })
    .run();
  db.insert(account)
    .values({ ...fixture.account, ...dates })
    .run();
  // Keep the synthetic legacy login alive independently of the test's date.
  // Token, signed cookie and password hash are unchanged 1.6.23 output.
  db.insert(session)
    .values({
      ...fixture.session,
      ...dates,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .run();
});
afterAll(() => {
  db?.$client.close();
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function request(
  endpoint: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return new Request(`${baseURL}/api/auth${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

it.each([
  ["browser", { Cookie: fixture.cookie }],
  ["Expo", { Cookie: fixture.cookie, "expo-origin": "overtchat://" }],
  [
    "desktop",
    { Authorization: `Bearer ${fixture.bearer}`, Origin: "overtchat://app" },
  ],
] as const)(
  "keeps the 1.6.23 %s session valid after the upgrade and server restart",
  async (_client, headers) => {
    for (const instance of [auth, betterAuth(auth.options)]) {
      const response = await instance.handler(request("/get-session", headers));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { id: fixture.user.id, role: "admin" },
        session: { id: fixture.session.id },
      });
    }
  },
);

it.each([
  ["browser", { Origin: baseURL }],
  ["Expo", { "expo-origin": "overtchat://" }],
  ["desktop", { Origin: "overtchat://app" }],
] as const)(
  "accepts existing passwords and the released %s sign-in protocol",
  async (_client, headers) => {
    const response = await auth.handler(
      request("/sign-in/email", headers, {
        email: fixture.user.email,
        password: fixture.password,
      }),
    );
    expect(response.status).toBe(200);
    const token = response.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=",
    );
    expect(await response.json()).toMatchObject({
      user: { id: fixture.user.id },
    });
    const login = await auth.handler(
      request("/get-session", { Authorization: `Bearer ${token}` }),
    );
    expect(await login.json()).toMatchObject({ user: { id: fixture.user.id } });
  },
);

it("revokes an old mobile cookie and desktop bearer token together on sign-out", async () => {
  const response = await auth.handler(
    request(
      "/sign-out",
      {
        "expo-origin": "overtchat://",
        Cookie: fixture.cookie,
      },
      {},
    ),
  );
  expect(response.status).toBe(200);
  const credentials: Record<string, string>[] = [
    { Cookie: fixture.cookie },
    { Authorization: `Bearer ${fixture.bearer}` },
  ];
  for (const headers of credentials) {
    const result = await auth.handler(request("/get-session", headers));
    expect(await result.json()).toBeNull();
  }
});
