import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  daemonRequest: vi.fn(),
  isOnline: vi.fn(),
  supports: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentWorkspace: mocks.getOwnedAgentWorkspace,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    request: mocks.daemonRequest,
    isOnline: mocks.isOnline,
    supports: mocks.supports,
  },
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ id: "workspace" }) };
const url = "http://server.test/api/agent-workspaces/workspace/git-branches";
const target = { transport: "local", shellMode: "interactive" };

function post(body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent workspace Git branches route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "owner", role: "admin" } });
    mocks.getOwnedAgentWorkspace.mockResolvedValue({
      host: { connectorId: "connector", transport: "local", userId: "owner" },
      connection: { id: "connection", shellMode: "interactive" },
      workspace: { id: "workspace", path: "/srv/project" },
    });
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
  });

  it("lists branches through the owner-scoped stored host", async () => {
    const branches = {
      isGit: true,
      current: "main",
      truncated: false,
      branches: [
        { name: "main", remote: null, current: true, worktreePath: null, committedAt: 1_000 },
      ],
    };
    mocks.daemonRequest.mockResolvedValue(branches);

    const response = await GET(new Request(url), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getOwnedAgentWorkspace).toHaveBeenCalledWith("workspace", "owner");
    expect(mocks.supports).toHaveBeenCalledWith("connector", "workspace-git-branch-v1");
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "list_git_branches",
      target,
      path: "/srv/project",
    });
    await expect(response.json()).resolves.toEqual({ branches });
  });

  it("switches branches and relays each outcome", async () => {
    mocks.daemonRequest.mockResolvedValueOnce({ status: "changes_present", changedFiles: 2 });
    const changes = await POST(post({ branch: { kind: "local", name: "feature" } }), context);
    await expect(changes.json()).resolves.toEqual({
      result: { status: "changes_present", changedFiles: 2 },
    });
    expect(mocks.daemonRequest).toHaveBeenLastCalledWith("connector", {
      type: "switch_git_branch",
      target,
      path: "/srv/project",
      branch: { kind: "local", name: "feature" },
      stash: false,
    });

    const switched = {
      status: "switched",
      branch: "feature",
      stashed: true,
      restored: false,
      keptStash: null,
    };
    mocks.daemonRequest.mockResolvedValueOnce(switched);
    const response = await POST(
      post({ branch: { kind: "remote", remote: "origin", name: "feature" }, stash: true }),
      context,
    );
    await expect(response.json()).resolves.toEqual({ result: switched });
    expect(mocks.daemonRequest).toHaveBeenLastCalledWith(
      "connector",
      expect.objectContaining({
        branch: { kind: "remote", remote: "origin", name: "feature" },
        stash: true,
      }),
    );
  });

  it("returns Git's error message verbatim", async () => {
    mocks.daemonRequest.mockRejectedValueOnce(
      new Error("fatal: 'feature' is already checked out at '/srv/feature'"),
    );
    const response = await POST(post({ branch: { kind: "local", name: "feature" } }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "fatal: 'feature' is already checked out at '/srv/feature'",
    });
  });

  it("rejects malformed switches and invalid connector results", async () => {
    for (const body of [
      null,
      {},
      { branch: { kind: "local", name: "--force" } },
      { branch: { kind: "local", name: "main" }, stash: "yes" },
    ]) {
      expect((await POST(post(body), context)).status).toBe(400);
    }
    expect(mocks.daemonRequest).not.toHaveBeenCalled();

    mocks.daemonRequest.mockResolvedValueOnce({ status: "switched" });
    const response = await POST(post({ branch: { kind: "local", name: "main" } }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The Host Connector returned an invalid branch switch result.",
    });
  });

  it("asks for a connector update before relaying to an old connector", async () => {
    mocks.supports.mockReturnValue(false);
    expect((await GET(new Request(url), context)).status).toBe(426);
    expect((await POST(post({ branch: { kind: "local", name: "main" } }), context)).status).toBe(
      426,
    );
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated, non-admin, and cross-user access", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(new Request(url), context)).status).toBe(401);
    mocks.getSession.mockResolvedValueOnce({ user: { id: "owner", role: "user" } });
    expect((await POST(post({ branch: { kind: "local", name: "main" } }), context)).status).toBe(
      403,
    );
    mocks.getOwnedAgentWorkspace.mockResolvedValueOnce(null);
    expect((await POST(post({ branch: { kind: "local", name: "main" } }), context)).status).toBe(
      404,
    );
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
