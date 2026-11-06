import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";
import { INTEGRATIONS } from "@/lib/integrations/schema";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("integration-connections");
let repository: typeof import("@/lib/db/integrations");
let connections: typeof import("./connections");

const GMAIL_SCOPES = INTEGRATIONS.gmail.scopes.join(" ");
const CALENDAR_SCOPES = INTEGRATIONS.calendar.scopes.join(" ");

/** Stands in for Google: answers by endpoint and records what it was sent. */
function google(
  answers: Partial<
    Record<
      "token" | "profile" | "calendar" | "revoke",
      () => { status: number; body: unknown }
    >
  >,
) {
  const calls: { endpoint: string; body: Record<string, string> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const endpoint = url.endsWith("/token")
      ? "token"
      : url.endsWith("/revoke")
        ? "revoke"
        : url.endsWith("/calendars/primary")
          ? "calendar"
          : "profile";
    calls.push({
      endpoint,
      body: init?.body
        ? Object.fromEntries(init.body as URLSearchParams)
        : {},
    });
    const answer = answers[endpoint]?.() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  return calls;
}

const grant = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    access_token: "access-1",
    expires_in: 3600,
    refresh_token: "refresh-1",
    scope: GMAIL_SCOPES,
    ...overrides,
  },
});
const profile = () => ({
  status: 200,
  body: { emailAddress: "ada@example.test" },
});

function start(userId = "ada") {
  const { url } = connections.startIntegrationAuthorization(userId, "google", [
    "gmail",
  ]);
  return new URL(url).searchParams.get("state")!;
}
const redirect = (state: string, code = "the-code") =>
  `http://localhost:1/?state=${state}&code=${code}`;

beforeAll(async () => {
  repository = await import("@/lib/db/integrations");
  connections = await import("./connections");
});
beforeEach(() => {
  database.reset();
  repository.saveIntegrationOauthClient("google", {
    clientId: "client-1",
    clientSecret: "secret-1",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => database.close());

describe("signing in", () => {
  it("refuses until an administrator has set up the client", () => {
    repository.deleteIntegrationOauthClient("google");
    expect(() =>
      connections.startIntegrationAuthorization("ada", "google", ["gmail"]),
    ).toThrow(/administrator/);
  });

  it("stores the grant under the account Google names", async () => {
    const calls = google({ token: grant, profile });
    const state = start();

    const [integration] = await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(state),
    );

    expect(integration.connection).toMatchObject({
      accountEmail: "ada@example.test",
      status: "connected",
    });
    expect(calls[0]).toMatchObject({
      endpoint: "token",
      body: { code: "the-code", client_id: "client-1" },
    });
    expect(calls[0].body.code_verifier).toBeTruthy();
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      refreshToken: "refresh-1",
      accessToken: "access-1",
    });
    expect(repository.getIntegrationAuthorization("ada", "google")).toBeNull();
  });

  it("keeps the sign-in open when a different address is pasted", async () => {
    const calls = google({ token: grant, profile });
    const state = start();

    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "google",
        redirect("someone-elses-state"),
      ),
    ).rejects.toThrow(/different sign-in/);
    expect(calls).toHaveLength(0);

    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(state),
    );
    expect(repository.getIntegrationConnection("ada", "gmail")).not.toBeNull();
  });

  it("does not finish a sign-in another user started", async () => {
    google({ token: grant, profile });
    const state = start("ada");

    await expect(
      connections.completeIntegrationAuthorization(
        "grace",
        "google",
        redirect(state),
      ),
    ).rejects.toThrow(/never started/);
    expect(repository.getIntegrationConnection("grace", "gmail")).toBeNull();
  });

  it("spends a sign-in on its first exchange", async () => {
    google({ token: () => ({ status: 400, body: { error: "invalid_grant" } }) });
    const state = start();

    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "google",
        redirect(state),
      ),
    ).rejects.toThrow(/no longer accepts that sign-in code/);
    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "google",
        redirect(state),
      ),
    ).rejects.toThrow(/already used/);
  });

  it("expires a sign-in left open too long", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-04T10:00:00Z") });
    const calls = google({ token: grant, profile });
    const state = start();
    vi.setSystemTime(new Date("2026-11-04T10:16:00Z"));

    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "google",
        redirect(state),
      ),
    ).rejects.toThrow(/expired/);
    expect(calls).toHaveLength(0);
  });

  it("refuses and withdraws a grant missing a permission", async () => {
    const calls = google({
      token: () =>
        grant({ scope: "https://www.googleapis.com/auth/gmail.readonly" }),
      profile,
    });
    const state = start();

    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "google",
        redirect(state),
      ),
    ).rejects.toThrow(/keep the checkboxes/);

    expect(calls.at(-1)).toEqual({
      endpoint: "revoke",
      body: { token: "refresh-1" },
    });
    expect(repository.getIntegrationConnection("ada", "gmail")).toBeNull();
  });

  it("keeps an earlier sign-in when a new one grants nothing usable", async () => {
    google({ token: grant, profile });
    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(start()),
    );
    vi.restoreAllMocks();
    const calls = google({
      token: () =>
        grant({
          refresh_token: "refresh-2",
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        }),
      profile,
    });

    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "google",
        redirect(start()),
      ),
    ).rejects.toThrow(/keep the checkboxes/);

    // Withdrawing the new sign-in could take the working one with it.
    expect(calls.some((call) => call.endpoint === "revoke")).toBe(false);
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      refreshToken: "refresh-1",
      status: "connected",
    });
  });

  it("replaces the sign-in when the same account signs in again", async () => {
    google({ token: grant, profile });
    // A first sign-in has no account to preselect.
    const first = connections.startIntegrationAuthorization("ada", "google", [
      "gmail",
    ]);
    expect(new URL(first.url).searchParams.has("login_hint")).toBe(false);
    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(new URL(first.url).searchParams.get("state")!),
    );
    expect(
      new URL(
        connections.startIntegrationAuthorization("ada", "google", ["gmail"])
          .url,
      ).searchParams.get("login_hint"),
    ).toBe("ada@example.test");
    vi.restoreAllMocks();
    const second = google({
      token: () => grant({ refresh_token: "refresh-2" }),
      profile,
    });

    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(start()),
    );

    // Both sign-ins are the same account's approval of this client.
    expect(second.some((call) => call.endpoint === "revoke")).toBe(false);
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      refreshToken: "refresh-2",
    });
  });

  it("withdraws the earlier grant when a different account signs in", async () => {
    google({ token: grant, profile });
    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(start()),
    );
    vi.restoreAllMocks();
    const second = google({
      token: () => grant({ refresh_token: "refresh-2" }),
      profile: () => ({
        status: 200,
        body: { emailAddress: "ada.work@example.test" },
      }),
    });

    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(start()),
    );

    expect(second.at(-1)).toEqual({
      endpoint: "revoke",
      body: { token: "refresh-1" },
    });
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      accountEmail: "ada.work@example.test",
      refreshToken: "refresh-2",
    });
  });

  it("connects what Google granted when the user left a permission unticked", async () => {
    const calls = google({
      token: () => grant({ scope: CALENDAR_SCOPES }),
      calendar: () => ({ status: 200, body: { id: "ada@example.test" } }),
    });
    const { url } = connections.startIntegrationAuthorization("ada", "google", [
      "gmail",
      "calendar",
    ]);
    expect(new URL(url).searchParams.get("scope")).toBe(
      `${GMAIL_SCOPES} ${CALENDAR_SCOPES}`,
    );

    const integrations = await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(new URL(url).searchParams.get("state")!),
    );

    expect(
      integrations.map(({ id, connection }) => [id, connection?.accountEmail]),
    ).toEqual([
      ["gmail", undefined],
      ["calendar", "ada@example.test"],
    ]);
    // Without Gmail, the calendar names the account.
    expect(calls.map(({ endpoint }) => endpoint)).toEqual(["token", "calendar"]);
    await expect(
      connections.getIntegrationAccessToken("ada", "gmail"),
    ).rejects.toMatchObject({ code: "not_connected" });
    await expect(
      connections.getIntegrationAccessToken("ada", "calendar"),
    ).resolves.toBe("access-1");
  });

  it("covers both with one sign-in, and widens a sign-in that covered one", async () => {
    google({ token: grant, profile });
    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(start()),
    );
    expect(repository.getIntegration("ada", "calendar").connection).toBeNull();
    vi.restoreAllMocks();

    google({
      token: () =>
        grant({
          refresh_token: "refresh-2",
          scope: `${GMAIL_SCOPES} ${CALENDAR_SCOPES}`,
        }),
      profile,
    });
    const { url } = connections.startIntegrationAuthorization("ada", "google", [
      "gmail",
      "calendar",
    ]);
    const integrations = await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(new URL(url).searchParams.get("state")!),
    );

    expect(integrations.map(({ connection }) => connection?.status)).toEqual([
      "connected",
      "connected",
    ]);
    expect(repository.getIntegrationAccount("ada", "google")).toMatchObject({
      refreshToken: "refresh-2",
    });
  });

  it("asks only for what the user chose, and refuses an empty choice", () => {
    const { url } = connections.startIntegrationAuthorization("ada", "google", [
      "gmail",
    ]);
    expect(new URL(url).searchParams.get("scope")).toBe(GMAIL_SCOPES);
    expect(() =>
      connections.startIntegrationAuthorization("ada", "google", []),
    ).toThrow(/at least one/);
  });
});

describe("disconnecting", () => {
  it("removes the connection and withdraws the grant", async () => {
    const calls = google({ token: grant, profile });
    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(start()),
    );

    await connections.disconnectIntegrationAccount("ada", "google");

    expect(repository.getIntegrationConnection("ada", "gmail")).toBeNull();
    expect(calls.at(-1)).toEqual({
      endpoint: "revoke",
      body: { token: "refresh-1" },
    });
  });
});

describe("access tokens", () => {
  async function connectAda() {
    google({ token: grant, profile });
    await connections.completeIntegrationAuthorization(
      "ada",
      "google",
      redirect(start()),
    );
    vi.restoreAllMocks();
  }

  function expireAccessToken() {
    database.raw
      .prepare("UPDATE integration_accounts SET access_token_expires_at = ?")
      .run(Date.now() + 30_000);
  }

  it("reuses a token that is still good", async () => {
    await connectAda();
    const calls = google({});

    await expect(
      connections.getIntegrationAccessToken("ada", "gmail"),
    ).resolves.toBe("access-1");
    expect(calls).toHaveLength(0);
  });

  it("refreshes once for concurrent callers and stores the result", async () => {
    await connectAda();
    expireAccessToken();
    const calls = google({
      token: () => ({
        status: 200,
        body: { access_token: "access-2", expires_in: 3600 },
      }),
    });

    const tokens = await Promise.all([
      connections.getIntegrationAccessToken("ada", "gmail"),
      connections.getIntegrationAccessToken("ada", "gmail"),
    ]);

    expect(tokens).toEqual(["access-2", "access-2"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      accessToken: "access-2",
      status: "connected",
    });
  });

  it("asks for a new sign-in once Google withdraws the grant", async () => {
    await connectAda();
    expireAccessToken();
    const calls = google({
      token: () => ({ status: 400, body: { error: "invalid_grant" } }),
    });

    await expect(
      connections.getIntegrationAccessToken("ada", "gmail"),
    ).rejects.toMatchObject({ code: "needs_reconnect" });
    expect(repository.getIntegration("ada", "gmail").connection).toMatchObject({
      status: "needs_reconnect",
      accountEmail: "ada@example.test",
    });

    // No further requests reach Google until the user signs in again.
    await expect(
      connections.getIntegrationAccessToken("ada", "gmail"),
    ).rejects.toMatchObject({ code: "needs_reconnect" });
    expect(calls).toHaveLength(1);
  });

  it("keeps the connection through a failure that is not the user's", async () => {
    await connectAda();
    expireAccessToken();
    google({ token: () => ({ status: 503, body: {} }) });

    await expect(
      connections.getIntegrationAccessToken("ada", "gmail"),
    ).rejects.toMatchObject({ status: 502 });
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      status: "connected",
    });
  });

  it("reports an account that was never connected", async () => {
    await expect(
      connections.getIntegrationAccessToken("grace", "gmail"),
    ).rejects.toMatchObject({ code: "not_connected" });
  });
});
