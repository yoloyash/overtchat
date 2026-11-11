import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getChat: vi.fn(),
  getChatMessage: vi.fn(),
  getChatGeneration: vi.fn(),
  getLatestChatGeneration: vi.fn(),
  withGmailEmailState: vi.fn(),
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

vi.mock("@/lib/integrations/gmail-emails", () => ({
  withGmailEmailState: mocks.withGmailEmailState,
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
    mocks.withGmailEmailState.mockImplementation(
      (_userId: string, messages: unknown[]) => messages,
    );
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

  it("marks the emails the user saved or sent, as a loaded chat does", async () => {
    const stored = {
      id: "assistant",
      role: "assistant",
      parts: [{ type: "tool-gmail_compose", output: { emailId: "e-1" } }],
    };
    const marked = {
      ...stored,
      parts: [
        {
          type: "tool-gmail_compose",
          output: { emailId: "e-1", sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t1" } },
        },
      ],
    };
    mocks.getLatestChatGeneration.mockResolvedValue({
      id: "stream",
      status: "complete",
      startedAt: new Date(1_000),
      completedAt: new Date(2_000),
      responseMessageId: "assistant",
    });
    mocks.getChatMessage.mockResolvedValue(stored);
    mocks.withGmailEmailState.mockReturnValue([marked]);

    const response = await GET(request(), context);

    // The client replaces the message it loaded with this one.
    expect(mocks.withGmailEmailState).toHaveBeenCalledWith("user", [stored]);
    await expect(response.json()).resolves.toMatchObject({ responseMessage: marked });
  });

  it("does not reveal another user's chat", async () => {
    mocks.getChat.mockResolvedValue(null);

    const response = await GET(request(), context);

    expect(response.status).toBe(404);
    expect(mocks.getLatestChatGeneration).not.toHaveBeenCalled();
  });
});
