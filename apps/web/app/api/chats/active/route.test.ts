import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listActiveChatIds: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/chats", () => ({
  listActiveChatIds: mocks.listActiveChatIds,
}));

import { GET } from "./route";

const request = () =>
  new Request("http://server.test/api/chats/active", {
    headers: { Origin: "exp://mobile" },
  });

describe("active chats", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.listActiveChatIds.mockResolvedValue(["chat-a", "chat-b"]);
  });

  it("returns the authenticated user's active chat IDs", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.listActiveChatIds).toHaveBeenCalledWith("user");
    await expect(response.json()).resolves.toEqual({
      activeChatIds: ["chat-a", "chat-b"],
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.listActiveChatIds).not.toHaveBeenCalled();
  });
});
