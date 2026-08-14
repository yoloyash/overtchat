import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCapability: vi.fn(),
  updateCapability: vi.fn(),
  toAdmin: vi.fn((value) => value),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  getServerCapability: mocks.getCapability,
  updateServerCapability: mocks.updateCapability,
  toAdminServerCapability: mocks.toAdmin,
}));

import { PUT } from "./route";

function request(body: object): Request {
  return new Request("http://server.test/api/server-capabilities/search", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const searchInput = {
  provider: "brave",
  bundledInstalled: false,
  baseUrl: null,
  apiKey: null,
  model: null,
  voice: null,
};

describe("server capability update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.getCapability.mockReturnValue({
      id: "search",
      provider: "brave",
      bundledInstalled: false,
      apiKey: "stored-key",
    });
    mocks.updateCapability.mockImplementation((value) => value);
  });

  it("requires an administrator", async () => {
    mocks.getSession.mockResolvedValue({ user: { role: "user" } });
    expect(
      (await PUT(request(searchInput), { params: Promise.resolve({ id: "search" }) })).status,
    ).toBe(403);
    expect(mocks.updateCapability).not.toHaveBeenCalled();
  });

  it("keeps a masked API key when the admin leaves the field blank", async () => {
    const response = await PUT(request(searchInput), {
      params: Promise.resolve({ id: "search" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateCapability).toHaveBeenCalledWith({
      ...searchInput,
      id: "search",
      apiKey: "stored-key",
    });
  });

  it("does not activate a bundled service absent from this server", async () => {
    const response = await PUT(
      request({ ...searchInput, provider: "bundled" }),
      { params: Promise.resolve({ id: "search" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "not_installed",
    });
    expect(mocks.updateCapability).not.toHaveBeenCalled();
  });

  it("requires a Brave API key when none is stored", async () => {
    mocks.getCapability.mockReturnValue({
      id: "search",
      bundledInstalled: false,
      apiKey: null,
    });

    const response = await PUT(request(searchInput), {
      params: Promise.resolve({ id: "search" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Enter a Brave Search API key.",
    });
  });
});
