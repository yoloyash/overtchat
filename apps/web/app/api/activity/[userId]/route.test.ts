import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUsageMember: vi.fn(),
  getUsageTrackingStart: vi.fn(),
  getUserUsageTotals: vi.fn(),
  listUserDailyUsage: vi.fn(),
  listUserModelUsage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/usage", () => ({
  getUsageMember: mocks.getUsageMember,
  getUsageTrackingStart: mocks.getUsageTrackingStart,
  getUserUsageTotals: mocks.getUserUsageTotals,
  listUserDailyUsage: mocks.listUserDailyUsage,
  listUserModelUsage: mocks.listUserModelUsage,
}));

import { GET } from "./route";

const totals = {
  generations: 1,
  inputTokens: 90,
  uncachedInputTokens: 90,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 100,
};

function context(userId = "person") {
  return { params: Promise.resolve({ userId }) };
}

describe("activity profile API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "viewer" } });
    mocks.getUsageMember.mockResolvedValue({
      id: "person",
      name: "Person",
      image: null,
      createdAt: new Date(500),
    });
    mocks.getUserUsageTotals.mockResolvedValue(totals);
    mocks.listUserDailyUsage.mockResolvedValue([
      { ...totals, date: "2026-07-30" },
    ]);
    mocks.listUserModelUsage.mockResolvedValue([
      { ...totals, providerId: "custom", model: "family-model" },
    ]);
    mocks.getUsageTrackingStart.mockResolvedValue(new Date(1_000));
  });

  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/api/activity/person"),
      context(),
    );

    expect(response.status).toBe(401);
    expect(mocks.getUsageMember).not.toHaveBeenCalled();
  });

  it("returns not found for a deleted or unknown person", async () => {
    mocks.getUsageMember.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/api/activity/missing"),
      context("missing"),
    );

    expect(response.status).toBe(404);
  });

  it("returns daily, model, and all-time profile usage", async () => {
    const response = await GET(
      new Request(
        "http://server.test/api/activity/person?timeZone=America%2FLos_Angeles",
      ),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.listUserDailyUsage).toHaveBeenCalledWith(
      "person",
      expect.objectContaining({
        timeZone: "America/Los_Angeles",
        from: expect.any(Date),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      member: { id: "person", name: "Person", createdAt: 500 },
      throughDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      trackingStartedAt: 1_000,
      totals: { totalTokens: 100 },
      daily: [{ date: "2026-07-30", totalTokens: 100 }],
      models: [{ model: "family-model", generations: 1 }],
    });
  });

  it("falls back to UTC for an invalid time zone", async () => {
    await GET(
      new Request(
        "http://server.test/api/activity/person?timeZone=not-a-zone",
      ),
      context(),
    );

    expect(mocks.listUserDailyUsage).toHaveBeenCalledWith(
      "person",
      expect.objectContaining({ timeZone: "UTC" }),
    );
  });
});
