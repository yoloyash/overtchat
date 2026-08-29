import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPersonalizationSnapshot: vi.fn(),
  updatePersonalization: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/personalization", () => ({
  getPersonalizationSnapshot: mocks.getPersonalizationSnapshot,
  updatePersonalization: mocks.updatePersonalization,
}));

import { GET, PATCH } from "./route";

function request(method: "GET" | "PATCH", body?: unknown) {
  return new Request("http://server.test/api/personalization", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

describe("personalization API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
  });

  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await PATCH(request("PATCH", {}))).status).toBe(401);
  });

  it("returns the authenticated user's snapshot", async () => {
    const snapshot = {
      personalization: {
        enabled: true,
        preferredName: null,
        occupation: null,
        about: null,
      },
      memories: [],
      memoryUsage: { characters: 0, limit: 4_096, entries: 0, entryLimit: 50 },
    };
    mocks.getPersonalizationSnapshot.mockResolvedValue(snapshot);

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mocks.getPersonalizationSnapshot).toHaveBeenCalledWith("user");
  });

  it("normalizes and updates profile fields", async () => {
    mocks.updatePersonalization.mockResolvedValue({
      enabled: false,
      preferredName: "Boomer",
      occupation: null,
      about: null,
    });

    const response = await PATCH(
      request("PATCH", {
        enabled: false,
        preferredName: "  Boomer  ",
        occupation: "   ",
        about: null,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updatePersonalization).toHaveBeenCalledWith("user", {
      enabled: false,
      preferredName: "Boomer",
      occupation: null,
      about: null,
    });
  });

  it("rejects invalid profile values", async () => {
    const response = await PATCH(
      request("PATCH", {
        enabled: true,
        preferredName: "x".repeat(81),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.updatePersonalization).not.toHaveBeenCalled();
  });
});
