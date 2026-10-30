import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  markAgentSessionRead: vi.fn(),
  markAgentSessionUnread: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
  markAgentSessionRead: mocks.markAgentSessionRead,
  markAgentSessionUnread: mocks.markAgentSessionUnread,
}));

import { PUT } from "./route";

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/agent-sessions/session/read", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "session" }) },
  );
}

describe("agent session read state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValue({ agentSession: { id: "session" } });
    mocks.markAgentSessionUnread.mockReturnValue(true);
  });

  it("marks the owner's session read and unread", async () => {
    expect((await put({ read: true })).status).toBe(204);
    expect(mocks.getOwnedAgentSession).toHaveBeenCalledWith("session", "owner");
    expect(mocks.markAgentSessionRead).toHaveBeenCalledWith("session");

    expect((await put({ read: false })).status).toBe(204);
    expect(mocks.markAgentSessionUnread).toHaveBeenCalledWith("session");
  });

  it("rejects marking a session without a finished turn unread", async () => {
    mocks.markAgentSessionUnread.mockReturnValue(false);
    expect((await put({ read: false })).status).toBe(409);
  });

  it("rejects invalid bodies, other users' sessions and non-admins", async () => {
    expect((await put({ read: "yes" })).status).toBe(400);
    expect((await put({ read: true, at: 1 })).status).toBe(400);

    mocks.getOwnedAgentSession.mockResolvedValue(null);
    expect((await put({ read: true })).status).toBe(404);

    mocks.getSession.mockResolvedValue({ user: { id: "member", role: "user" } });
    expect((await put({ read: true })).status).toBe(403);

    mocks.getSession.mockResolvedValue(null);
    expect((await put({ read: true })).status).toBe(401);
    expect(mocks.markAgentSessionRead).not.toHaveBeenCalled();
  });
});
