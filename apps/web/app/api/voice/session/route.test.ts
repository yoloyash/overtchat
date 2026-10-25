import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  end: vi.fn(),
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

vi.mock("@/lib/db/voiceSessions", () => ({ claimVoiceSession: mocks.claim, endVoiceSession: mocks.end }));

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
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" }, session: { id: "auth-1" } });
    mocks.claim.mockReturnValue("voice-1");
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
        sessionId: "voice-1",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      token: "ticket",
      chatId: "chat-1",
      voice: "af_heart",
    });
  });

  it("binds existing voice chats to their project", async () => {
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
        sessionId: "voice-1",
      }),
    );
  });

  it("allows voice in existing text chats", async () => {
    mocks.getChat.mockResolvedValue({
      id: "chat-1",
      userId: "user-1",
      projectId: null,
      kind: "text",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith("chat-1", "user-1", "auth-1");
    expect((await response.json()).tools).toBeUndefined();
  });
  it("rejects a competing session before issuing a ticket", async () => {
    mocks.claim.mockReturnValue(null);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.issueVoiceTicket).not.toHaveBeenCalled();
  });

});
