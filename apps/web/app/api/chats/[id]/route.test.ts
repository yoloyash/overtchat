import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteChat: vi.fn(),
  updateChatMetadata: vi.fn(),
  closeChatMcpRuntime: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/chats", () => ({
  deleteChat: mocks.deleteChat,
  updateChatMetadata: mocks.updateChatMetadata,
}));
vi.mock("@/lib/mcp/manager", () => ({
  closeChatMcpRuntime: mocks.closeChatMcpRuntime,
}));

import { DELETE, PATCH } from "./route";

describe("chat pinning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.updateChatMetadata.mockResolvedValue(true);
  });

  function patch(body: unknown) {
    return PATCH(
      new Request("http://server.test/api/chats/chat", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "chat" }) },
    );
  }

  it.each([true, false])("sets pinned=%s for the authenticated owner", async (pinned) => {
    expect((await patch({ pinned })).status).toBe(204);
    expect(mocks.updateChatMetadata).toHaveBeenCalledWith("chat", "user", { pinned });
  });

  it("passes combined fields to one atomic metadata operation", async () => {
    const body = { title: "Renamed", pinned: true, projectId: "project" };
    expect((await patch(body)).status).toBe(204);
    expect(mocks.updateChatMetadata).toHaveBeenCalledExactlyOnceWith("chat", "user", body);
  });

  it("returns 404 when the atomic metadata operation rejects a destination", async () => {
    mocks.updateChatMetadata.mockResolvedValue(false);
    expect((await patch({ pinned: true, projectId: "missing-project" })).status).toBe(404);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await patch({ pinned: true })).status).toBe(401);
    expect(mocks.updateChatMetadata).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not own the chat or it is missing", async () => {
    mocks.updateChatMetadata.mockResolvedValue(false);
    expect((await patch({ pinned: true })).status).toBe(404);
  });

  it.each(["true", 1, null, {}, []])("rejects an invalid pin value before any mutation: %j", async (pinned) => {
    expect((await patch({ title: "New title", pinned })).status).toBe(400);
    expect(mocks.updateChatMetadata).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await PATCH(
      new Request("http://server.test/api/chats/chat", { method: "PATCH", body: "{" }),
      { params: Promise.resolve({ id: "chat" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.updateChatMetadata).not.toHaveBeenCalled();
  });
});

describe("chat deletion MCP cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.deleteChat.mockResolvedValue(undefined);
    mocks.closeChatMcpRuntime.mockResolvedValue(undefined);
  });

  it("closes the deleted chat's MCP runtime", async () => {
    const response = await DELETE(
      new Request("http://server.test/api/chats/chat", { method: "DELETE" }),
      { params: Promise.resolve({ id: "chat" }) },
    );

    expect(response.status).toBe(204);
    expect(mocks.deleteChat).toHaveBeenCalledWith("chat", "user");
    expect(mocks.closeChatMcpRuntime).toHaveBeenCalledWith({
      chatId: "chat",
      userId: "user",
    });
  });

  it("does not touch a runtime for an unauthenticated request", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await DELETE(
      new Request("http://server.test/api/chats/chat", { method: "DELETE" }),
      { params: Promise.resolve({ id: "chat" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.deleteChat).not.toHaveBeenCalled();
    expect(mocks.closeChatMcpRuntime).not.toHaveBeenCalled();
  });
});
