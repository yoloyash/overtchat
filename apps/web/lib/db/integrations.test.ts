import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { INTEGRATIONS } from "@/lib/integrations/schema";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("integrations-db");
let repository: typeof import("./integrations");

beforeAll(async () => {
  repository = await import("./integrations");
});
beforeEach(() => database.reset());
afterAll(() => database.close());

function connect(
  userId: string,
  refreshToken = `refresh-${userId}`,
  scopes: string[] = [...INTEGRATIONS.gmail.scopes],
) {
  repository.saveIntegrationAccount({
    userId,
    provider: "google",
    accountEmail: `${userId}@example.test`,
    refreshToken,
    accessToken: `access-${userId}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    scopes,
  });
}

describe("provider OAuth client", () => {
  it("reports the client without its secret", () => {
    expect(
      repository.toIntegrationOauthClient(
        "google",
        repository.getIntegrationOauthClient("google"),
      ),
    ).toEqual({ provider: "google", clientId: null, clientSecretSet: false });

    const row = repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    expect(repository.toIntegrationOauthClient("google", row)).toEqual({
      provider: "google",
      clientId: "client-1",
      clientSecretSet: true,
    });
  });

  it("keeps connections when only the secret changes", () => {
    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    connect("ada");

    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-2",
    });

    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      status: "connected",
      accessToken: "access-ada",
    });
  });

  it("asks everyone to sign in again when the client ID changes", () => {
    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    connect("ada");
    connect("grace");
    repository.saveIntegrationAuthorization({
      userId: "ada",
      provider: "google",
      state: "state",
      codeVerifier: "verifier",
    });

    repository.saveIntegrationOauthClient("google", {
      clientId: "client-2",
      clientSecret: "secret-1",
    });

    for (const userId of ["ada", "grace"]) {
      expect(repository.getIntegrationConnection(userId, "gmail")).toMatchObject(
        { status: "needs_reconnect", accessToken: null },
      );
    }
    expect(repository.getIntegrationAuthorization("ada", "google")).toBeNull();
  });

  it("removes every connection with the client", () => {
    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    connect("ada");

    repository.deleteIntegrationOauthClient("google");

    expect(repository.getIntegrationOauthClient("google")).toBeNull();
    expect(repository.getIntegrationConnection("ada", "gmail")).toBeNull();
    expect(repository.getIntegration("ada", "gmail")).toEqual({
      id: "gmail",
      provider: "google",
      configured: false,
      connection: null,
    });
  });
});

describe("connections", () => {
  it("lists each user's own connection and never its tokens", () => {
    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    connect("ada");

    const [gmail] = repository.listIntegrations("ada");
    expect(gmail).toEqual({
      id: "gmail",
      provider: "google",
      configured: true,
      connection: {
        accountEmail: "ada@example.test",
        status: "connected",
        connectedAt: expect.any(String),
        alwaysOn: false,
        sendWithoutAsking: false,
      },
    });
    expect(JSON.stringify(gmail)).not.toContain("refresh-ada");
    expect(JSON.stringify(gmail)).not.toContain("access-ada");
    expect(repository.listIntegrations("grace")[0].connection).toBeNull();
  });

  it("keeps the choice to use it in every chat through a new sign-in", () => {
    expect(repository.setIntegrationAlwaysOn("ada", "gmail", true)).toBe(false);

    connect("ada");
    expect(repository.setIntegrationAlwaysOn("ada", "gmail", true)).toBe(true);
    expect(repository.getIntegration("ada", "gmail").connection?.alwaysOn).toBe(true);

    connect("ada", "newer-refresh");
    expect(repository.getIntegration("ada", "gmail").connection?.alwaysOn).toBe(true);

    expect(repository.setIntegrationAlwaysOn("ada", "gmail", false)).toBe(true);
    expect(repository.getIntegration("ada", "gmail").connection?.alwaysOn).toBe(false);
  });

  it("covers an integration only when its permission was granted", () => {
    repository.saveIntegrationOauthClient("google", {
      clientId: "client-1",
      clientSecret: "secret-1",
    });
    connect("ada", "refresh-ada", ["https://example.test/another-scope"]);

    expect(repository.getIntegrationAccount("ada", "google")).not.toBeNull();
    expect(repository.getIntegrationConnection("ada", "gmail")).toBeNull();
    expect(repository.getIntegration("ada", "gmail").connection).toBeNull();
  });

  it("restores a connection that needed a new sign-in", () => {
    connect("ada", "old-refresh");
    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      provider: "google",
      refreshToken: "old-refresh",
    });

    connect("ada", "new-refresh");

    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      status: "connected",
      refreshToken: "new-refresh",
    });
  });

  it("ignores a refresh that finished after the user signed in again", () => {
    connect("ada", "new-refresh");

    repository.storeIntegrationAccessToken({
      userId: "ada",
      provider: "google",
      refreshToken: "old-refresh",
      accessToken: "stale-access",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    });
    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      provider: "google",
      refreshToken: "old-refresh",
    });

    expect(repository.getIntegrationConnection("ada", "gmail")).toMatchObject({
      status: "connected",
      accessToken: "access-ada",
    });
  });

  it("deletes a user's connections with the user", () => {
    connect("ada");
    database.raw.pragma("foreign_keys = ON");
    database.raw.exec("DELETE FROM user WHERE id = 'ada'");
    expect(repository.getIntegrationConnection("ada", "gmail")).toBeNull();
  });
});
