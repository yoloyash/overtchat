import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getChat: vi.fn(),
  getChatUsageTotals: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/chats", () => ({
  getChat: mocks.getChat,
}));
vi.mock("@/lib/db/usage", () => ({
  getChatUsageTotals: mocks.getChatUsageTotals,
}));

import { GET } from "./route";

const totals = {
  generations: 2,
  pricedGenerations: 1,
  inputTokens: 1_000,
  uncachedInputTokens: 800,
  outputTokens: 200,
  cacheReadTokens: 200,
  cacheWriteTokens: 0,
  totalTokens: 1_200,
  inputCostNanoUsd: 1_000,
  outputCostNanoUsd: 2_000,
  cacheReadCostNanoUsd: 100,
  cacheWriteCostNanoUsd: 0,
  totalCostNanoUsd: 3_100,
};

function context(id = "chat") {
  return { params: Promise.resolve({ id }) };
}

describe("chat usage API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "owner" } });
    mocks.getChat.mockResolvedValue({ id: "chat", userId: "owner" });
    mocks.getChatUsageTotals.mockResolvedValue(totals);
  });

  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/api/chat/chat/usage"),
      context(),
    );

    expect(response.status).toBe(401);
    expect(mocks.getChat).not.toHaveBeenCalled();
    expect(mocks.getChatUsageTotals).not.toHaveBeenCalled();
  });

  it("returns not found when the viewer does not own the chat", async () => {
    mocks.getChat.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/api/chat/private/usage"),
      context("private"),
    );

    expect(response.status).toBe(404);
    expect(mocks.getChat).toHaveBeenCalledWith("private", "owner");
    expect(mocks.getChatUsageTotals).not.toHaveBeenCalled();
  });

  it("returns session totals for the owning user", async () => {
    const response = await GET(
      new Request("http://server.test/api/chat/chat/usage"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.getChatUsageTotals).toHaveBeenCalledWith("chat", "owner");
    await expect(response.json()).resolves.toEqual({ usage: totals });
  });
});
