import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAppUpdateStatus: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/update-check", () => ({
  getAppUpdateStatus: mocks.getAppUpdateStatus,
}));

import { GET } from "./route";

const request = () => new Request("http://server.test/api/app-update");

describe("GET /api/app-update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.getAppUpdateStatus.mockResolvedValue({
      currentVersion: "0.16.0",
      latestVersion: "0.17.0",
      updateAvailable: true,
    });
  });

  it("requires an administrator", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);

    mocks.getSession.mockResolvedValueOnce({
      user: { id: "member", role: "user" },
    });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.getAppUpdateStatus).not.toHaveBeenCalled();
  });

  it("returns the cached update status without HTTP caching", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      currentVersion: "0.16.0",
      latestVersion: "0.17.0",
      updateAvailable: true,
    });
  });
});
