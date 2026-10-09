import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifyTicket: vi.fn(),
  syncVoiceHistory: vi.fn(),
  getChat: vi.fn(),
  modelConfigForUser: vi.fn((row: unknown) => row),
  getModelConfig: vi.fn(),
  ensureChatTitle: vi.fn(),
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
  modelConfigForUser: mocks.modelConfigForUser,
}));
vi.mock("@/lib/title", () => ({ ensureChatTitle: mocks.ensureChatTitle }));

import { POST } from "./route";

function request(items: unknown[], headers: Record<string, string> = {}) {
  return new Request("http://app.test/api/voice/history", {
    method: "POST",
    headers: {
      "X-OvertChat-Voice-Ticket": "ticket",
      "Content-Type": "application/json",
      ...headers,
    },
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
    });
    mocks.getModelConfig.mockResolvedValue({ id: "model-1", enabled: true });
    mocks.getChat.mockResolvedValue({
      id: "chat-1",
      title: null,
      kind: "voice",
      projectId: null,
      updatedAt: new Date(1_000),
    });
  });

  it("persists completed transcript and tool items under the ticket chat", async () => {
    mocks.ensureChatTitle.mockImplementation(async () => {
      await Promise.resolve();
      mocks.getChat.mockResolvedValue({
        id: "chat-1",
        title: "Greeting",
        pinned: true,
        kind: "voice",
        projectId: null,
        updatedAt: new Date(1_000),
      });
      return "Greeting";
    });
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
    expect(mocks.ensureChatTitle).toHaveBeenCalledWith({
      chatId: "chat-1",
      userId: "user-1",
      fallbackModelConfig: { id: "model-1", enabled: true },
    });
    await expect(response.json()).resolves.toMatchObject({
      chat: { id: "chat-1", title: "Greeting", pinned: true },
    });
  });

  it("keeps Authorization for a bearer session alongside the ticket", async () => {
    const response = await POST(
      request(
        [
          {
            type: "message",
            id: "user-item",
            previousId: null,
            role: "user",
            status: "completed",
            text: "Hello",
          },
        ],
        { Authorization: "Bearer session" },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyTicket).toHaveBeenCalledWith("ticket");
    const { headers } = mocks.getSession.mock.calls[0][0] as { headers: Headers };
    expect(headers.get("authorization")).toBe("Bearer session");
  });

  it("titles a per-user model's chat with the ticket user's credential", async () => {
    const own = { id: "model-1", enabled: true, apiKey: "user-key" };
    mocks.modelConfigForUser.mockReturnValue(own);

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
      ]),
    );

    expect(response.status).toBe(200);
    expect(mocks.modelConfigForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "model-1" }),
      "user-1",
    );
    expect(mocks.ensureChatTitle).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackModelConfig: own }),
    );
  });

  it("requires a ticket", async () => {
    const response = await POST(
      request([], { "X-OvertChat-Voice-Ticket": "" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.verifyTicket).not.toHaveBeenCalled();
  });

  it("requires the authenticated user and signed ticket to agree", async () => {
    mocks.verifyTicket.mockReturnValue({ userId: "other" });

    expect((await POST(request([]))).status).toBe(401);
    expect(mocks.syncVoiceHistory).not.toHaveBeenCalled();
  });
});
