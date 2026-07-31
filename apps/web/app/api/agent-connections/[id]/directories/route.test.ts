import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentConnection: vi.fn(),
  targetForStoredHost: vi.fn(),
  listAgentDirectories: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentConnection: mocks.getOwnedAgentConnection,
}));
vi.mock("@/lib/agents/runtime/target", () => ({
  targetForStoredHost: mocks.targetForStoredHost,
}));
vi.mock("@/lib/agents/pi/probe", () => ({
  listAgentDirectories: mocks.listAgentDirectories,
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "connection" }) };

describe("agent directory route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentConnection.mockResolvedValue({
      host: { transport: "local", userId: "owner" },
      connection: { id: "connection" },
    });
    mocks.targetForStoredHost.mockReturnValue({ transport: "local" });
    mocks.listAgentDirectories.mockResolvedValue({
      path: "/home/owner",
      parent: "/home",
      directories: [{ name: "code", path: "/home/owner/code" }],
    });
  });

  it("browses through the owner-scoped stored host", async () => {
    const response = await GET(
      new Request(
        "http://server.test/api/agent-connections/connection/directories?path=%2Fhome%2Fowner",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.targetForStoredHost).toHaveBeenCalled();
    expect(mocks.listAgentDirectories).toHaveBeenCalledWith(
      { transport: "local" },
      "/home/owner",
    );
    await expect(response.json()).resolves.toMatchObject({
      directory: { path: "/home/owner" },
    });
  });

  it("rejects cross-user and relative-path requests before execution", async () => {
    mocks.getOwnedAgentConnection.mockResolvedValueOnce(null);
    expect(
      (
        await GET(
          new Request("http://server.test/directories"),
          context,
        )
      ).status,
    ).toBe(404);

    const relative = await GET(
      new Request("http://server.test/directories?path=relative"),
      context,
    );
    expect(relative.status).toBe(400);
    expect(mocks.listAgentDirectories).not.toHaveBeenCalled();
  });
});
