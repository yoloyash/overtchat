import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getChat: vi.fn(),
  getLatestMessageRowId: vi.fn(),
  getModelConfig: vi.fn(),
  getProject: vi.fn(),
  getServerCapability: vi.fn(),
  getVoiceCapability: vi.fn(),
  issueVoiceTicket: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/chats", () => ({
  getChat: mocks.getChat,
  getLatestMessageRowId: mocks.getLatestMessageRowId,
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
}));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/db/serverCapabilities", () => ({
  getServerCapability: mocks.getServerCapability,
}));
vi.mock("@/lib/voice/capability", () => ({
  getVoiceCapability: mocks.getVoiceCapability,
}));
vi.mock("@/lib/voice/ticket", () => ({
  issueVoiceTicket: mocks.issueVoiceTicket,
}));

import { POST } from "./route";

function request() {
  return new Request("http://app.test/api/voice/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: "chat-1",
      projectId: null,
      modelConfigId: "model-1",
      webSearchEnabled: true,
      timeZone: "UTC",
    }),
  });
}

describe("voice session", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getVoiceCapability.mockReturnValue({
      available: true,
      installed: true,
      unavailableReason: null,
    });
    mocks.getModelConfig.mockResolvedValue({
      id: "model-1",
      enabled: true,
      toolCallingEnabled: true,
    });
    mocks.getServerCapability.mockImplementation((id: string) =>
      id === "search"
        ? { provider: "bundled" }
        : { provider: "bundled", voice: "af_heart" },
    );
    mocks.getChat.mockResolvedValue(null);
    mocks.getLatestMessageRowId.mockResolvedValue(null);
    mocks.issueVoiceTicket.mockReturnValue({ token: "ticket" });
  });

  it("binds a new voice session to the requested empty chat", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.issueVoiceTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        chatId: "chat-1",
        projectId: null,
        newChat: true,
        historyThroughRowId: null,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      token: "ticket",
      chatId: "chat-1",
      voice: "af_heart",
    });
  });

  it("snapshots resumable voice history", async () => {
    mocks.getChat.mockResolvedValue({
      id: "chat-1",
      userId: "user-1",
      projectId: "project-1",
      kind: "voice",
    });
    mocks.getLatestMessageRowId.mockResolvedValue(42);

    expect((await POST(request())).status).toBe(200);
    expect(mocks.issueVoiceTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        newChat: false,
        historyThroughRowId: 42,
      }),
    );
  });

  it("does not add voice to an existing text chat", async () => {
    mocks.getChat.mockResolvedValue({
      id: "chat-1",
      userId: "user-1",
      projectId: null,
      kind: "text",
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.issueVoiceTicket).not.toHaveBeenCalled();
  });
});
