import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listUsageLeaderboard: vi.fn(),
  getUsageTrackingStart: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/usage", () => ({
  listUsageLeaderboard: mocks.listUsageLeaderboard,
  getUsageTrackingStart: mocks.getUsageTrackingStart,
}));

import { GET } from "./route";

describe("activity leaderboard API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.listUsageLeaderboard.mockResolvedValue([
      {
        userId: "user",
        name: "Person",
        image: null,
        generations: 2,
        inputTokens: 100,
        uncachedInputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 120,
      },
    ]);
    mocks.getUsageTrackingStart.mockResolvedValue(new Date(1_000));
  });

  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/api/activity"),
    );

    expect(response.status).toBe(401);
    expect(mocks.listUsageLeaderboard).not.toHaveBeenCalled();
  });

  it("defaults to 30 days and returns leaderboard profile fields", async () => {
    const now = Date.now();
    const response = await GET(
      new Request("http://server.test/api/activity?period=invalid"),
    );

    expect(response.status).toBe(200);
    const [range] = mocks.listUsageLeaderboard.mock.calls[0];
    expect(range.from.getTime()).toBeGreaterThanOrEqual(
      now - 30 * 24 * 60 * 60 * 1_000,
    );
    await expect(response.json()).resolves.toMatchObject({
      period: "30d",
      trackingStartedAt: 1_000,
      entries: [{ userId: "user", name: "Person", totalTokens: 120 }],
    });
  });

  it("supports an unbounded all-time view", async () => {
    const response = await GET(
      new Request("http://server.test/api/activity?period=all"),
    );

    expect(response.status).toBe(200);
    expect(mocks.listUsageLeaderboard).toHaveBeenCalledWith({});
    await expect(response.json()).resolves.toMatchObject({ period: "all" });
  });
});
