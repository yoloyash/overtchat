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
import {
  TWO_FACTOR_CLIENT_HEADER,
  type SignInApprovalState,
  type SignInRequest,
} from "@overtchat/shared";
import type { db as database } from "@/lib/db/client";

vi.mock("server-only", () => ({}));
const notify = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/notifications/sender", () => ({
  notifySignInRequest: notify,
}));
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "overtchat-sign-in-approval-"),
);
const baseURL = "http://localhost:4717";
const password = "original-password-123";
const chromeOnMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
vi.stubEnv("DATABASE_URL", path.join(directory, "chat.db"));
vi.stubEnv("BETTER_AUTH_URL", baseURL);
vi.stubEnv("BETTER_AUTH_SECRET", "isolated-auth-test-secret-1234567890123456");
vi.stubEnv("OVERTCHAT_E2E_DISABLE_AUTH_RATE_LIMIT", "1");

let auth: (typeof import("./server"))["auth"];
let db: typeof database;
let listRequests: (typeof import("@/app/api/sign-in-requests/route"))["GET"];
let decideRequest: (typeof import("@/app/api/sign-in-requests/[id]/route"))["POST"];
type Login = { id: string; cookie: string };
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
  options: { cookie?: string; method?: string } = {},
) {
  return auth.handler(
    new Request(`${baseURL}/api/auth${endpoint}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Origin: baseURL,
        "User-Agent": chromeOnMac,
        [TWO_FACTOR_CLIENT_HEADER]: "1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
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
  return { id: data.user.id, cookie: cookies(response) };
}

let memberSecret = "";
let memberBackupCodes: string[] = [];
const memberTotp = () => createOTP(memberSecret).totp();

async function enroll(login: Login) {
  const enable = await request(
    "/two-factor/enable",
    { password },
    { cookie: login.cookie },
  );
  const { totpURI, backupCodes } = (await enable.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = new TextDecoder().decode(
    base32.decode(new URL(totpURI).searchParams.get("secret")!),
  );
  memberSecret = secret;
  memberBackupCodes = backupCodes;
  const code = await createOTP(secret).totp();
  const verify = await request(
    "/two-factor/verify-totp",
    { code },
    { cookie: login.cookie },
  );
  expect(verify.status).toBe(200);
  login.cookie = cookies(verify);
}

/** Enters the password on a new device; returns its pending sign-in cookie. */
async function startSignIn(email = "member@example.com") {
  const response = await request("/sign-in/email", { email, password });
  const data = await response.json();
  expect(data).toMatchObject({ twoFactorRedirect: true });
  return { pending: cookies(response), methods: data.twoFactorMethods };
}

async function requestApproval(pending: string) {
  const sent = await request("/two-factor/send-otp", {}, { cookie: pending });
  expect(sent.status).toBe(200);
  return approvalState(pending);
}

async function approvalState(
  pending: string,
  wait = false,
): Promise<SignInApprovalState> {
  const response = await request(
    `/two-factor/approval${wait ? "?wait=1" : ""}`,
    undefined,
    { cookie: pending },
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function pending(login: Login): Promise<SignInRequest[]> {
  const response = await listRequests(
    new Request(`${baseURL}/api/sign-in-requests`, {
      headers: { Cookie: login.cookie },
    }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

function decide(login: Login, id: string, decision: unknown) {
  return decideRequest(
    new Request(`${baseURL}/api/sign-in-requests/${id}`, {
      method: "POST",
      headers: { Cookie: login.cookie, "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function approvalRows() {
  return db.$client
    .prepare("SELECT status, code FROM sign_in_approvals")
    .all() as { status: string; code: string | null }[];
}

beforeAll(async () => {
  db = (await import("@/lib/db/client")).db;
  (await import("@/lib/db/migrate")).runMigrations();
  auth = (await import("./server")).auth;
  listRequests = (await import("@/app/api/sign-in-requests/route")).GET;
  decideRequest = (await import("@/app/api/sign-in-requests/[id]/route")).POST;
});

beforeEach(async () => {
  notify.mockClear();
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
  await enroll(member);
});

afterAll(() => {
  db?.$client.close();
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("sign-in approval", () => {
  it("signs in once a signed-in device picks the matching number", async () => {
    const { pending: cookie, methods } = await startSignIn();
    expect(methods).toEqual(expect.arrayContaining(["totp", "otp"]));

    const state = await requestApproval(cookie);
    expect(state).toMatchObject({ status: "pending" });
    const number = (state as { number: number }).number;
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: member.id, device: "Chrome on macOS" }),
    );

    const [shown] = await pending(member);
    expect(shown).toMatchObject({ device: "Chrome on macOS" });
    expect(shown.choices).toHaveLength(3);
    expect(shown.choices).toContain(number);
    expect(JSON.stringify(shown)).not.toMatch(/code/);

    const answer = await decide(member, shown.id, { approve: true, number });
    expect(await answer.json()).toEqual({ result: "approved" });

    const approved = await approvalState(cookie);
    expect(approved).toMatchObject({ status: "approved" });
    const verified = await request(
      "/two-factor/verify-otp",
      { code: (approved as { code: string }).code },
      { cookie },
    );
    expect(verified.status).toBe(200);
    const session = await request("/get-session", undefined, {
      cookie: cookies(verified),
    });
    expect((await session.json()).user.email).toBe("member@example.com");
    // The code is gone once it signed in.
    expect(approvalRows()).toEqual([]);
    expect(await pending(member)).toEqual([]);
  });

  it.each([
    ["an authenticator code", "totp"],
    ["a backup code", "backup"],
  ])("stops asking once the sign-in finishes with %s", async (_label, method) => {
    const { pending: cookie } = await startSignIn();
    await requestApproval(cookie);
    expect(await pending(member)).toHaveLength(1);
    const verified =
      method === "totp"
        ? await request("/two-factor/verify-totp", { code: await memberTotp() }, { cookie })
        : await request("/two-factor/verify-backup-code", { code: memberBackupCodes[0] }, { cookie });
    expect(verified.status).toBe(200);
    expect(await pending(member)).toEqual([]);
    expect(approvalRows()).toEqual([]);
  });

  it("shows the whole IPv6 address of the signing-in device", async () => {
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          Origin: baseURL,
          [TWO_FACTOR_CLIENT_HEADER]: "1",
          "Content-Type": "application/json",
          "X-Forwarded-For": "2001:db8:85a3::8a2e:370:7334",
        },
        body: JSON.stringify({ email: "member@example.com", password }),
      }),
    );
    const cookie = cookies(response);
    await auth.handler(
      new Request(`${baseURL}/api/auth/two-factor/send-otp`, {
        method: "POST",
        headers: {
          Origin: baseURL,
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-Forwarded-For": "2001:db8:85a3::8a2e:370:7334",
        },
        body: "{}",
      }),
    );
    expect((await pending(member))[0].ipAddress).toBe("2001:db8:85a3::8a2e:370:7334");
  });

  it("answers a waiting sign-in as soon as it's approved", async () => {
    const { pending: cookie } = await startSignIn();
    const { number } = (await requestApproval(cookie)) as { number: number };
    const waiting = approvalState(cookie, true);
    const [shown] = await pending(member);
    await decide(member, shown.id, { approve: true, number });
    expect(await waiting).toMatchObject({ status: "approved" });
  });

  it("blocks the sign-in when the wrong number is picked", async () => {
    const { pending: cookie } = await startSignIn();
    const { number } = (await requestApproval(cookie)) as { number: number };
    const [shown] = await pending(member);
    const wrong = shown.choices.find((choice) => choice !== number)!;
    const answer = await decide(member, shown.id, { approve: true, number: wrong });
    expect(await answer.json()).toEqual({ result: "mismatch" });
    expect(await approvalState(cookie)).toEqual({ status: "mismatch" });
    expect(approvalRows()).toEqual([{ status: "mismatch", code: null }]);
    // A second answer doesn't change it.
    const retry = await decide(member, shown.id, { approve: true, number });
    expect(retry.status).toBe(409);
    expect(await approvalState(cookie)).toEqual({ status: "mismatch" });
  });

  it("blocks the sign-in when it's denied", async () => {
    const { pending: cookie } = await startSignIn();
    await requestApproval(cookie);
    const [shown] = await pending(member);
    await decide(member, shown.id, { approve: false });
    expect(await approvalState(cookie)).toEqual({ status: "denied" });
    expect(approvalRows()).toEqual([{ status: "denied", code: null }]);
  });

  it("releases the code only to the sign-in that was approved", async () => {
    const first = await startSignIn();
    const second = await startSignIn();
    const { number } = (await requestApproval(first.pending)) as {
      number: number;
    };
    const firstId = (await pending(member))[0].id;
    await requestApproval(second.pending);
    await decide(member, firstId, { approve: true, number });
    expect(await approvalState(first.pending)).toMatchObject({
      status: "approved",
    });
    expect(await approvalState(second.pending)).toMatchObject({
      status: "pending",
    });
    // The first sign-in's code doesn't work with the second's cookie.
    const { code } = (await approvalState(first.pending)) as { code: string };
    const stolen = await request(
      "/two-factor/verify-otp",
      { code },
      { cookie: second.pending },
    );
    expect(stolen.status).toBe(401);
  });

  it("keeps other accounts and impersonated logins from answering", async () => {
    const { pending: cookie } = await startSignIn();
    const { number } = (await requestApproval(cookie)) as { number: number };
    const [shown] = await pending(member);
    expect(await pending(admin)).toEqual([]);
    expect((await decide(admin, shown.id, { approve: true, number })).status).toBe(404);

    db.$client
      .prepare("UPDATE session SET impersonated_by = ? WHERE user_id = ?")
      .run(admin.id, member.id);
    expect(await pending(member)).toEqual([]);
    expect((await decide(member, shown.id, { approve: true, number })).status).toBe(403);
    expect(await approvalState(cookie)).toMatchObject({ status: "pending" });
  });

  it("expires with the one-time code", async () => {
    const { pending: cookie } = await startSignIn();
    const { number } = (await requestApproval(cookie)) as { number: number };
    const [shown] = await pending(member);
    db.$client
      .prepare("UPDATE sign_in_approvals SET expires_at = ?")
      .run(Date.now() - 1);
    expect(await approvalState(cookie)).toEqual({ status: "expired" });
    expect(await pending(member)).toEqual([]);
    const late = await decide(member, shown.id, { approve: true, number });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ result: "expired" });
  });

  it("replaces the earlier request when the sign-in asks again", async () => {
    const { pending: cookie } = await startSignIn();
    await requestApproval(cookie);
    const [earlier] = await pending(member);
    await requestApproval(cookie);
    const requests = await pending(member);
    expect(requests).toHaveLength(1);
    expect(requests[0].id).not.toBe(earlier.id);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("limits how many requests a user's sign-ins can send", async () => {
    for (let i = 0; i < 5; i++) await requestApproval((await startSignIn()).pending);
    const { pending: cookie } = await startSignIn();
    const refused = await request("/two-factor/send-otp", {}, { cookie });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      code: "TOO_MANY_SIGN_IN_REQUESTS",
    });
    expect(notify).toHaveBeenCalledTimes(5);
  });

  it("needs a device that's signed in to approve", async () => {
    db.$client
      .prepare("DELETE FROM session WHERE user_id = ?")
      .run(member.id);
    const { pending: cookie } = await startSignIn();
    const refused = await request("/two-factor/send-otp", {}, { cookie });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "NO_SIGN_IN_APPROVERS" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("sends codes only for a pending sign-in", async () => {
    const signedIn = await request(
      "/two-factor/send-otp",
      {},
      { cookie: member.cookie },
    );
    expect(signedIn.status).toBe(400);
    expect((await request("/two-factor/approval")).status).toBe(401);
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps an authenticator as the way to set up two-factor", async () => {
    const response = await request(
      "/two-factor/enable",
      { password, method: "otp" },
      { cookie: admin.cookie },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "AUTHENTICATOR_REQUIRED",
    });
  });

  it("drops pending requests when an administrator resets two-factor", async () => {
    const { pending: cookie } = await startSignIn();
    await requestApproval(cookie);
    const reset = await request(
      "/admin/reset-user-two-factor",
      { userId: member.id, currentPassword: password },
      { cookie: admin.cookie },
    );
    expect(reset.status).toBe(200);
    expect(approvalRows()).toEqual([]);
  });
});
