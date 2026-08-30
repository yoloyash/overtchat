import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getChat: vi.fn(),
  getMessages: vi.fn(),
  getMessagesPage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/chats", () => ({
  getChat: mocks.getChat,
  getMessages: mocks.getMessages,
  getMessagesPage: mocks.getMessagesPage,
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "chat" }) };

describe("chat message history route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.getChat.mockResolvedValue({
      id: "chat",
      projectId: "project",
      kind: "voice",
    });
    mocks.getMessages.mockResolvedValue([]);
    mocks.getMessagesPage.mockResolvedValue({
      messages: [{ id: "message", role: "user", parts: [] }],
      nextCursor: "41",
    });
  });

  it("serves an authenticated cursor page", async () => {
    const request = new Request(
      "http://server.test/api/chat/chat/messages?cursor=42&limit=32",
    );

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(mocks.getMessagesPage).toHaveBeenCalledWith("chat", {
      cursor: "42",
      limit: 32,
    });
    await expect(response.json()).resolves.toEqual({
      messages: [{ id: "message", role: "user", parts: [] }],
      nextCursor: "41",
      projectId: "project",
      kind: "voice",
    });
  });

  it("rejects malformed pagination without querying messages", async () => {
    const request = new Request(
      "http://server.test/api/chat/chat/messages?cursor=nope&limit=500",
    );

    const response = await GET(request, context);

    expect(response.status).toBe(400);
    expect(mocks.getMessagesPage).not.toHaveBeenCalled();
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it("retains the unpaginated response for existing mobile clients", async () => {
    const request = new Request(
      "http://server.test/api/chat/chat/messages",
    );

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(mocks.getMessages).toHaveBeenCalledWith("chat");
    expect(mocks.getMessagesPage).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      messages: [],
      projectId: "project",
      kind: "voice",
    });
  });
});
