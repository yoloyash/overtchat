import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationTestDatabase } from "@/lib/integrations/test-database";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

const database = createIntegrationTestDatabase("integration-oauth-route");
let route: typeof import("./route");
let repository: typeof import("@/lib/db/integrations");

const context = (provider = "google") => ({
  params: Promise.resolve({ provider }),
});

function request(method: string, body?: object): Request {
  return new Request("http://server.test/api/integration-oauth-clients/google", {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

beforeAll(async () => {
  route = await import("./route");
  repository = await import("@/lib/db/integrations");
});
beforeEach(() => {
  database.reset();
  mocks.getSession.mockResolvedValue({ user: { id: "ada", role: "admin" } });
});
afterAll(() => database.close());

describe("provider OAuth client administration", () => {
  it("is closed to everyone but administrators", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "grace", role: "user" } });
    const body = { clientId: "client-1", clientSecret: "secret-1" };

    expect((await route.GET(request("GET"), context())).status).toBe(403);
    expect((await route.PUT(request("PUT", body), context())).status).toBe(403);
    expect((await route.DELETE(request("DELETE"), context())).status).toBe(403);
    expect(repository.getIntegrationOauthClient("google")).toBeNull();

    mocks.getSession.mockResolvedValue(null);
    expect((await route.GET(request("GET"), context())).status).toBe(401);
  });

  it("does not know providers it has no integration for", async () => {
    expect((await route.GET(request("GET"), context("example"))).status).toBe(
      404,
    );
  });

  it("stores the client and never returns its secret", async () => {
    const saved = await route.PUT(
      request("PUT", { clientId: " client-1 ", clientSecret: "secret-1" }),
      context(),
    );
    const expected = {
      client: { provider: "google", clientId: "client-1", clientSecretSet: true },
    };

    expect(await saved.json()).toEqual(expected);
    expect(await (await route.GET(request("GET"), context())).json()).toEqual(
      expected,
    );
    expect(repository.getIntegrationOauthClient("google")?.clientSecret).toBe(
      "secret-1",
    );
  });

  it("needs a secret the first time and keeps it afterwards", async () => {
    const missing = await route.PUT(
      request("PUT", { clientId: "client-1", clientSecret: "" }),
      context(),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Client secret is required" });

    await route.PUT(
      request("PUT", { clientId: "client-1", clientSecret: "secret-1" }),
      context(),
    );
    const kept = await route.PUT(
      request("PUT", { clientId: "client-2", clientSecret: "" }),
      context(),
    );

    expect(kept.status).toBe(200);
    expect(repository.getIntegrationOauthClient("google")).toMatchObject({
      clientId: "client-2",
      clientSecret: "secret-1",
    });
  });

  it("removes the client", async () => {
    await route.PUT(
      request("PUT", { clientId: "client-1", clientSecret: "secret-1" }),
      context(),
    );

    expect((await route.DELETE(request("DELETE"), context())).status).toBe(204);
    expect(repository.getIntegrationOauthClient("google")).toBeNull();
  });
});
