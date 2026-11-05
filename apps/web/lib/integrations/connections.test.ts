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

/** Stands in for Google: answers by endpoint and records what it was sent. */
function google(
  answers: Partial<
    Record<"token" | "profile" | "revoke", () => { status: number; body: unknown }>
  >,
) {
  const calls: { endpoint: string; body: Record<string, string> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const endpoint = url.endsWith("/token")
      ? "token"
      : url.endsWith("/revoke")
        ? "revoke"
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
  const { url } = connections.startIntegrationAuthorization(userId, "gmail");
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
      connections.startIntegrationAuthorization("ada", "gmail"),
    ).toThrow(/administrator/);
  });

  it("stores the grant under the account Google names", async () => {
    const calls = google({ token: grant, profile });
    const state = start();

    const integration = await connections.completeIntegrationAuthorization(
      "ada",
      "gmail",
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
    expect(repository.getIntegrationAuthorization("ada", "gmail")).toBeNull();
  });

  it("keeps the sign-in open when a different address is pasted", async () => {
    const calls = google({ token: grant, profile });
    const state = start();

    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "gmail",
        redirect("someone-elses-state"),
      ),
    ).rejects.toThrow(/different sign-in/);
    expect(calls).toHaveLength(0);

    await connections.completeIntegrationAuthorization(
      "ada",
      "gmail",
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
        "gmail",
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
        "gmail",
        redirect(state),
      ),
    ).rejects.toThrow(/no longer accepts that sign-in code/);
    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "gmail",
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
        "gmail",
        redirect(state),
      ),
    ).rejects.toThrow(/expired/);
    expect(calls).toHaveLength(0);
  });

  it("refuses and withdraws a grant missing a permission", async () => {
    const calls = google({
      token: () => grant({ scope: INTEGRATIONS.gmail.scopes[0] }),
      profile,
    });
    const state = start();

    await expect(
      connections.completeIntegrationAuthorization(
        "ada",
        "gmail",
        redirect(state),
      ),
    ).rejects.toThrow(/tick every checkbox/);

    expect(calls.at(-1)).toEqual({
      endpoint: "revoke",
      body: { token: "refresh-1" },
    });
    expect(repository.getIntegrationConnection("ada", "gmail")).toBeNull();
  });

  it("withdraws the earlier grant when the user signs in again", async () => {
    const calls = google({ token: grant, profile });
    // A first sign-in has no account to preselect.
    const first = connections.startIntegrationAuthorization("ada", "gmail");
    expect(new URL(first.url).searchParams.has("login_hint")).toBe(false);
    await connections.completeIntegrationAuthorization(
      "ada",
      "gmail",
      redirect(new URL(first.url).searchParams.get("state")!),
    );
    expect(
      new URL(
        connections.startIntegrationAuthorization("ada", "gmail").url,
      ).searchParams.get("login_hint"),
    ).toBe("ada@example.test");
    vi.restoreAllMocks();
    const second = google({
      token: () => grant({ refresh_token: "refresh-2" }),
      profile,
    });

    await connections.completeIntegrationAuthorization(
      "ada",
      "gmail",
      redirect(start()),
    );

    expect(calls.some((call) => call.endpoint === "revoke")).toBe(false);
    expect(second.at(-1)).toEqual({
      endpoint: "revoke",
      body: { token: "refresh-1" },
    });
    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      refreshToken: "refresh-2",
    });
  });
});

describe("disconnecting", () => {
  it("removes the connection and withdraws the grant", async () => {
    const calls = google({ token: grant, profile });
    await connections.completeIntegrationAuthorization(
      "ada",
      "gmail",
      redirect(start()),
    );

    await connections.disconnectIntegration("ada", "gmail");

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
      "gmail",
      redirect(start()),
    );
    vi.restoreAllMocks();
  }

  function expireAccessToken() {
    database.raw
      .prepare("UPDATE integration_connections SET access_token_expires_at = ?")
      .run(Date.now() + 30_000);
  }

  it("asks for a new sign-in once a time-limited one has run out", async () => {
    google({
      token: () => grant({ refresh_token_expires_in: 604_799 }),
      profile,
    });
    const connected = await connections.completeIntegrationAuthorization(
      "ada",
      "gmail",
      redirect(start()),
    );
    vi.restoreAllMocks();
    const ends = new Date(connected.connection!.expiresAt!).getTime();
    expect(ends - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const calls = google({});
    await expect(
      connections.getIntegrationAccessToken("ada", "gmail"),
    ).resolves.toBe("access-1");

    vi.useFakeTimers({ now: ends + 1000, toFake: ["Date"] });

    // The access token Google issued would still be sent otherwise.
    await expect(
      connections.getIntegrationAccessToken("ada", "gmail"),
    ).rejects.toMatchObject({ code: "needs_reconnect" });
    expect(calls).toHaveLength(0);
    expect(repository.getIntegration("ada", "gmail").connection?.status).toBe(
      "needs_reconnect",
    );
  });

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
