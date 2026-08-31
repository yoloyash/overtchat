import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listCapabilities: vi.fn(),
  toAdmin: vi.fn((value) => value),
  getVoiceCapability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  listServerCapabilities: mocks.listCapabilities,
  toAdminServerCapability: mocks.toAdmin,
}));
vi.mock("@/lib/voice/capability", () => ({
  getVoiceCapability: mocks.getVoiceCapability,
}));

import { GET } from "./route";

describe("server capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { role: "admin" } });
    mocks.listCapabilities.mockReturnValue([{ id: "search", provider: "bundled" }]);
    mocks.getVoiceCapability.mockReturnValue({
      available: true,
      installed: true,
      unavailableReason: null,
    });
  });

  it("returns configurable providers and realtime voice status together", async () => {
    const response = await GET(
      new Request("http://server.test/api/server-capabilities"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      capabilities: [{ id: "search", provider: "bundled" }],
      voice: {
        available: true,
        installed: true,
        unavailableReason: null,
      },
    });
  });

  it("requires an administrator", async () => {
    mocks.getSession.mockResolvedValue({ user: { role: "user" } });
    const response = await GET(
      new Request("http://server.test/api/server-capabilities"),
    );

    expect(response.status).toBe(403);
    expect(mocks.listCapabilities).not.toHaveBeenCalled();
    expect(mocks.getVoiceCapability).not.toHaveBeenCalled();
  });
});
