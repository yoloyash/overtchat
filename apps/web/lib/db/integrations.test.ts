import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";

vi.mock("server-only", () => ({}));

const database = createIntegrationTestDatabase("integrations-db");
let repository: typeof import("./integrations");

beforeAll(async () => {
  repository = await import("./integrations");
});
beforeEach(() => database.reset());
afterAll(() => database.close());

function connect(userId: string, refreshToken = `refresh-${userId}`) {
  repository.saveIntegrationConnection({
    userId,
    integrationId: "gmail",
    accountEmail: `${userId}@example.test`,
    refreshToken,
    accessToken: `access-${userId}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
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
      integrationId: "gmail",
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
    expect(repository.getIntegrationAuthorization("ada", "gmail")).toBeNull();
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
      configured: true,
      connection: {
        accountEmail: "ada@example.test",
        status: "connected",
        connectedAt: expect.any(String),
      },
    });
    expect(JSON.stringify(gmail)).not.toContain("refresh-ada");
    expect(JSON.stringify(gmail)).not.toContain("access-ada");
    expect(repository.listIntegrations("grace")[0].connection).toBeNull();
  });

  it("restores a connection that needed a new sign-in", () => {
    connect("ada", "old-refresh");
    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      integrationId: "gmail",
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
      integrationId: "gmail",
      refreshToken: "old-refresh",
      accessToken: "stale-access",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    });
    repository.markIntegrationNeedsReconnect({
      userId: "ada",
      integrationId: "gmail",
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
