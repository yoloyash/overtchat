import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getChat: vi.fn(),
  getChatMessage: vi.fn(),
  getChatGeneration: vi.fn(),
  getLatestChatGeneration: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/chats", () => ({ getChat: mocks.getChat }));
vi.mock("@/lib/db/chatTurns", () => ({
  getChatMessage: mocks.getChatMessage,
  getChatGeneration: mocks.getChatGeneration,
  getLatestChatGeneration: mocks.getLatestChatGeneration,
}));

import { GET } from "./route";

const request = () =>
  new Request("http://server.test/api/chat/chat/stream/status", {
    headers: { Origin: "exp://mobile" },
  });
const context = { params: Promise.resolve({ id: "chat" }) };

describe("chat generation status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.getChat.mockResolvedValue({
      id: "chat",
      userId: "user",
      activeStreamId: null,
    });
    mocks.getLatestChatGeneration.mockResolvedValue(null);
    mocks.getChatGeneration.mockResolvedValue(null);
    mocks.getChatMessage.mockResolvedValue(null);
  });

  it("returns an authoritative running generation", async () => {
    mocks.getChat.mockResolvedValue({
      id: "chat",
      userId: "user",
      activeStreamId: "stream",
    });
    mocks.getChatGeneration.mockResolvedValue({
      id: "stream",
      status: "running",
      startedAt: new Date(1_000),
      completedAt: null,
      responseMessageId: null,
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      active: true,
      streamId: "stream",
      status: "running",
      startedAt: 1_000,
      completedAt: null,
    });
  });

  it("returns the persisted terminal assistant for reconciliation", async () => {
    const responseMessage = {
      id: "assistant",
      role: "assistant",
      parts: [{ type: "text", text: "Finished while backgrounded" }],
    };
    mocks.getLatestChatGeneration.mockResolvedValue({
      id: "stream",
      status: "complete",
      startedAt: new Date(1_000),
      completedAt: new Date(2_000),
      responseMessageId: "assistant",
    });
    mocks.getChatMessage.mockResolvedValue(responseMessage);

    const response = await GET(request(), context);

    await expect(response.json()).resolves.toEqual({
      active: false,
      streamId: "stream",
      status: "complete",
      startedAt: 1_000,
      completedAt: 2_000,
      responseMessage,
    });
  });

  it("does not reveal another user's chat", async () => {
    mocks.getChat.mockResolvedValue(null);

    const response = await GET(request(), context);

    expect(response.status).toBe(404);
    expect(mocks.getLatestChatGeneration).not.toHaveBeenCalled();
  });
});
