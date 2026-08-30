import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifyTicket: vi.fn(),
  syncVoiceHistory: vi.fn(),
  getChat: vi.fn(),
  getModelConfig: vi.fn(),
  getTaskModelConfig: vi.fn(),
  generateChatTitle: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/voice/ticket", () => ({
  verifyVoiceTicket: mocks.verifyTicket,
}));
vi.mock("@/lib/db/voiceChats", () => ({
  syncVoiceHistory: mocks.syncVoiceHistory,
}));
vi.mock("@/lib/db/chats", () => ({ getChat: mocks.getChat }));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
  getTaskModelConfig: mocks.getTaskModelConfig,
}));
vi.mock("@/lib/title", () => ({ generateChatTitle: mocks.generateChatTitle }));

import { POST } from "./route";

function request(items: unknown[], authorization = "Bearer ticket") {
  return new Request("http://app.test/api/voice/history", {
    method: "POST",
    headers: { authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

describe("voice history sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.verifyTicket.mockReturnValue({
      userId: "user-1",
      chatId: "chat-1",
      projectId: null,
      newChat: true,
      modelConfigId: "model-1",
    });
    mocks.syncVoiceHistory.mockReturnValue({
      status: "ok",
      createdChat: true,
      changed: true,
      firstUserParts: [{ type: "text", text: "Hello" }],
    });
    mocks.getModelConfig.mockResolvedValue({ id: "model-1", enabled: true });
    mocks.getTaskModelConfig.mockReturnValue(null);
    mocks.getChat.mockResolvedValue({
      id: "chat-1",
      title: null,
      kind: "voice",
      projectId: null,
      updatedAt: new Date(1_000),
    });
  });

  it("persists completed transcript and tool items under the ticket chat", async () => {
    const response = await POST(
      request([
        {
          type: "message",
          id: "user-item",
          previousId: null,
          role: "user",
          status: "completed",
          text: "Hello",
        },
        {
          type: "tool",
          id: "tool-item",
          previousId: "user-item",
          name: "web_search",
          status: "completed",
          input: { query: "news" },
          output: { sources: [] },
        },
      ]),
    );

    expect(response.status).toBe(200);
    expect(mocks.syncVoiceHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        userId: "user-1",
        allowCreate: true,
        history: [
          expect.objectContaining({ id: "voice:chat-1:user-item", role: "user" }),
          expect.objectContaining({ id: "voice:chat-1:tool-item", role: "assistant" }),
        ],
      }),
    );
    expect(mocks.generateChatTitle).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "chat-1", userId: "user-1" }),
    );
  });

  it("requires the authenticated user and signed ticket to agree", async () => {
    mocks.verifyTicket.mockReturnValue({ userId: "other" });

    expect((await POST(request([]))).status).toBe(401);
    expect(mocks.syncVoiceHistory).not.toHaveBeenCalled();
  });
});
