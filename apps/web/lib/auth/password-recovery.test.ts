import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  path.join(os.tmpdir(), "overtchat-password-recovery-"),
);
const baseURL = "http://localhost:4717";
const initialPassword = "original-password-123";
const replacement = "replacement-password-456";
const managementSecret = "isolated-test-management-secret-123456";
vi.stubEnv("DATABASE_URL", path.join(directory, "chat.db"));
vi.stubEnv("BETTER_AUTH_URL", baseURL);
vi.stubEnv("BETTER_AUTH_SECRET", "isolated-auth-test-secret-1234567890123456");
vi.stubEnv("OVERTCHAT_MANAGEMENT_SECRET", managementSecret);
vi.stubEnv("OVERTCHAT_E2E_DISABLE_AUTH_RATE_LIMIT", "1");

let auth: (typeof import("./server"))["auth"];
let db: typeof database;
let passwords: typeof import("@/lib/db/passwords");
let managementPOST: (typeof import("@/app/api/internal/management/password-reset/route"))["POST"];
type Login = { id: string; token: string; cookie: string };
let admin: Login;
let member: Login;

async function request(
  endpoint: string,
  body?: unknown,
  login?: Login,
  bearer = false,
) {
  return auth.handler(
    new Request(`${baseURL}/api/auth${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: baseURL,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(login
          ? bearer
            ? { Authorization: `Bearer ${login.token}` }
            : { Cookie: login.cookie }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function signIn(
  email: string,
  password = initialPassword,
): Promise<Login> {
  const response = await request("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  const data = await response.json();
  return {
    id: data.user.id,
    token: data.token,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}

function recoveryRequest(body: unknown, secret = managementSecret) {
  return new Request(`${baseURL}/api/internal/management/password-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}

function snapshot(userId: string) {
  return {
    account: db.$client
      .prepare("SELECT password FROM account WHERE user_id = ?")
      .get(userId),
    sessions: db.$client
      .prepare("SELECT id FROM session WHERE user_id = ? ORDER BY id")
      .all(userId),
  };
}

beforeAll(async () => {
  db = (await import("@/lib/db/client")).db;
  (await import("@/lib/db/migrate")).runMigrations();
  auth = (await import("./server")).auth;
  passwords = await import("@/lib/db/passwords");
  managementPOST = (
    await import("@/app/api/internal/management/password-reset/route")
  ).POST;
});

beforeEach(async () => {
  db.$client.exec("DELETE FROM user; DELETE FROM verification;");
  expect(
    (
      await request("/sign-up/email", {
        email: "admin@example.com",
        name: "Admin",
        password: initialPassword,
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
          password: initialPassword,
          role: "user",
        },
        admin,
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

describe("administrator password recovery", () => {
  it.each([
    "anonymous",
    "member",
    "self",
    "missing-password",
    "wrong-password",
  ])("rejects %s without modifying passwords or sessions", async (scenario) => {
    const before = snapshot(member.id);
    const result = await request(
      "/admin/reset-user-password",
      {
        userId: scenario === "self" ? admin.id : member.id,
        newPassword: replacement,
        ...(scenario === "missing-password"
          ? {}
          : {
              currentPassword:
                scenario === "wrong-password"
                  ? "wrong-password"
                  : initialPassword,
            }),
      },
      scenario === "anonymous"
        ? undefined
        : scenario === "member"
          ? member
          : admin,
    );
    expect(result.status).toBe(
      scenario === "anonymous" ? 401 : scenario === "member" ? 403 : 400,
    );
    expect(snapshot(member.id)).toEqual(before);
  });

  it("disables the stock reset endpoint so password confirmation cannot be bypassed", async () => {
    const before = snapshot(member.id);
    const response = await request(
      "/admin/set-user-password",
      { userId: member.id, newPassword: replacement },
      admin,
    );
    expect(response.status).toBe(404);
    expect(snapshot(member.id)).toEqual(before);
  });

  it.each(["short", "x".repeat(129)])(
    "enforces existing password limits",
    async (newPassword) => {
      const before = snapshot(member.id);
      expect(
        (
          await request(
            "/admin/reset-user-password",
            {
              userId: member.id,
              currentPassword: initialPassword,
              newPassword,
            },
            admin,
          )
        ).status,
      ).toBe(400);
      expect(snapshot(member.id)).toEqual(before);
    },
  );

  it("resets another admin through bearer auth and revokes browser, desktop, and mobile tokens", async () => {
    db.$client
      .prepare("UPDATE user SET role = ? WHERE id = ?")
      .run("admin", member.id);
    db.$client
      .prepare("INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)")
      .run("preserved-chat", member.id, "Keep my history");
    db.$client
      .prepare(
        "INSERT INTO user_personalization (user_id, preferred_name) VALUES (?, ?)",
      )
      .run(member.id, "Keep my settings");
    const desktop = await signIn("member@example.com");
    const mobile = await signIn("member@example.com");
    const adminBefore = snapshot(admin.id);
    const response = await request(
      "/admin/reset-user-password",
      {
        userId: member.id,
        currentPassword: initialPassword,
        newPassword: replacement,
      },
      admin,
      true,
    );
    expect(response.status).toBe(200);
    expect(snapshot(member.id).sessions).toEqual([]);
    expect(snapshot(admin.id)).toEqual(adminBefore);
    for (const login of [member, desktop, mobile]) {
      const session = await request(
        "/get-session",
        undefined,
        login,
        login !== member,
      );
      expect(await session.json()).toBeNull();
    }
    expect(
      (
        await request("/sign-in/email", {
          email: "member@example.com",
          password: initialPassword,
        })
      ).status,
    ).toBe(401);
    await signIn("member@example.com", replacement);
    expect(
      db.$client.prepare("SELECT role FROM user WHERE id = ?").get(member.id),
    ).toEqual({ role: "admin" });
    expect(
      db.$client
        .prepare("SELECT title FROM chats WHERE user_id = ?")
        .get(member.id),
    ).toEqual({ title: "Keep my history" });
    expect(
      db.$client
        .prepare(
          "SELECT preferred_name FROM user_personalization WHERE user_id = ?",
        )
        .get(member.id),
    ).toEqual({ preferred_name: "Keep my settings" });
  });

  it("checks current server-side role rather than an earlier session", async () => {
    const before = snapshot(member.id);
    db.$client
      .prepare("UPDATE user SET role = ? WHERE id = ?")
      .run("user", admin.id);
    expect(
      (
        await request(
          "/admin/reset-user-password",
          {
            userId: member.id,
            currentPassword: initialPassword,
            newPassword: replacement,
          },
          admin,
        )
      ).status,
    ).toBe(403);
    expect(snapshot(member.id)).toEqual(before);
  });
});

describe("operator password recovery", () => {
  it("does not create a password credential for an account without one", async () => {
    db.$client.prepare("DELETE FROM account WHERE user_id = ?").run(member.id);
    const before = snapshot(member.id);
    expect(
      (
        await managementPOST(
          recoveryRequest({
            email: "member@example.com",
            newPassword: replacement,
          }),
        )
      ).status,
    ).toBe(409);
    expect(snapshot(member.id)).toEqual(before);
  });
  it("recovers the sole administrator without a user login", async () => {
    const response = await managementPOST(
      recoveryRequest({ email: "ADMIN@EXAMPLE.COM", newPassword: replacement }),
    );
    expect(response.status).toBe(200);
    expect(snapshot(admin.id).sessions).toEqual([]);
    expect((await request("/get-session", undefined, admin, true)).status).toBe(
      200,
    );
    expect(
      await (await request("/get-session", undefined, admin)).json(),
    ).toBeNull();
    await signIn("admin@example.com", replacement);
    expect(
      db.$client.prepare("SELECT role FROM user WHERE id = ?").get(admin.id),
    ).toEqual({ role: "admin" });
  });

  it.each(["", "wrong-secret", "user-session"])(
    "rejects %s as management credentials",
    async (secret) => {
      const before = snapshot(admin.id);
      const response = await managementPOST(
        recoveryRequest(
          { email: "admin@example.com", newPassword: replacement },
          secret === "user-session" ? admin.token : secret,
        ),
      );
      expect(response.status).toBe(401);
      expect(snapshot(admin.id)).toEqual(before);
    },
  );

  it.each([
    [{ email: "admin@example.com", newPassword: "short" }, 400],
    [{ email: "admin@example.com", newPassword: "x".repeat(129) }, 400],
    [{ email: "invalid", newPassword: replacement }, 400],
    [{ email: "missing@example.com", newPassword: replacement }, 404],
  ])("rejects invalid recovery input", async (body, status) => {
    const before = snapshot(admin.id);
    expect((await managementPOST(recoveryRequest(body))).status).toBe(status);
    expect(snapshot(admin.id)).toEqual(before);
  });
});

describe("password reset transaction", () => {
  it("rolls back the replacement password if session revocation fails", () => {
    const before = snapshot(member.id);
    db.$client.exec(`CREATE TRIGGER fail_password_reset BEFORE DELETE ON session
      BEGIN SELECT RAISE(ABORT, 'simulated session deletion failure'); END;`);
    try {
      expect(() =>
        passwords.resetUserPassword(member.id, "replacement-hash"),
      ).toThrow();
      expect(snapshot(member.id)).toEqual(before);
    } finally {
      db.$client.exec("DROP TRIGGER fail_password_reset;");
    }
  });

  it("rejects authorization revoked while hashing", () => {
    const before = snapshot(member.id);
    const actorHash = passwords.findPasswordAccount(admin.id)!.password!;
    const login = db.$client
      .prepare("SELECT id FROM session WHERE token = ?")
      .get(admin.token) as { id: string };
    db.$client.prepare("DELETE FROM session WHERE id = ?").run(login.id);
    expect(
      passwords.resetUserPassword(member.id, "replacement-hash", {
        userId: admin.id,
        sessionId: login.id,
        passwordHash: actorHash,
      }),
    ).toBe("unauthorized");
    expect(snapshot(member.id)).toEqual(before);
  });
});

it("rate limits administrator password confirmation attempts", async () => {
  const context = await auth.$context;
  const previous = context.rateLimit.enabled;
  context.rateLimit.enabled = true;
  const before = snapshot(member.id);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (
          await request(
            "/admin/reset-user-password",
            {
              userId: member.id,
              currentPassword: "wrong-password",
              newPassword: replacement,
            },
            admin,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await request(
          "/admin/reset-user-password",
          {
            userId: member.id,
            currentPassword: initialPassword,
            newPassword: replacement,
          },
          admin,
        )
      ).status,
    ).toBe(429);
    expect(snapshot(member.id)).toEqual(before);
  } finally {
    context.rateLimit.enabled = previous;
  }
});
