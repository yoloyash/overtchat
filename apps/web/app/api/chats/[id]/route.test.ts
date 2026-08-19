import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteChat: vi.fn(),
  renameChat: vi.fn(),
  moveChatToProject: vi.fn(),
  closeChatMcpRuntime: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/chats", () => ({
  deleteChat: mocks.deleteChat,
  renameChat: mocks.renameChat,
}));
vi.mock("@/lib/db/projects", () => ({
  moveChatToProject: mocks.moveChatToProject,
}));
vi.mock("@/lib/mcp/manager", () => ({
  closeChatMcpRuntime: mocks.closeChatMcpRuntime,
}));

import { DELETE } from "./route";

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
