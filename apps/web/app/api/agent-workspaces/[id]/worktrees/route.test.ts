import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  findOwnedAgentWorkspaceForTargetProvider: vi.fn(),
  provisionAgentWorkspace: vi.fn(),
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
  findOwnedAgentWorkspaceForTargetProvider: mocks.findOwnedAgentWorkspaceForTargetProvider,
}));
vi.mock("@/lib/agents/connector/providerSnapshots", () => ({
  provisionAgentWorkspace: mocks.provisionAgentWorkspace,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    request: mocks.daemonRequest,
    isOnline: mocks.isOnline,
    supports: mocks.supports,
  },
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "workspace" }) };
const target = { transport: "ssh", alias: "devbox", shellMode: "login" };
const worktree = {
  path: "/home/me/.overtchat/worktrees/project-1/topic/app",
  worktreePath: "/home/me/.overtchat/worktrees/project-1/topic",
  name: "topic",
  branch: "topic",
};

function post(body: unknown): Request {
  return new Request("http://server.test/api/agent-workspaces/workspace/worktrees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent workspace worktree creation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "owner", role: "admin" } });
    mocks.getOwnedAgentWorkspace.mockResolvedValue({
      host: { connectorId: "connector", transport: "ssh", sshAlias: "devbox", userId: "owner" },
      connection: {
        id: "connection",
        provider: "codex",
        executable: "/usr/bin/codex",
        detectedVersion: "1.2.3",
        shellMode: "login",
      },
      workspace: { id: "workspace", path: "/srv/project/app", worktreeParentPath: null },
    });
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
    mocks.daemonRequest.mockResolvedValue(worktree);
    mocks.provisionAgentWorkspace.mockResolvedValue({
      providers: 1,
      created: 1,
      refreshed: 0,
      failures: [],
    });
    mocks.findOwnedAgentWorkspaceForTargetProvider.mockResolvedValue({
      workspace: { id: "created" },
    });
  });

  it("creates the worktree on the host and adds it as a nested workspace", async () => {
    const base = { kind: "remote", remote: "origin", name: "main" };
    const response = await POST(post({ base, branch: "topic" }), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ worktree, workspaceId: "created" });
    expect(mocks.supports).toHaveBeenCalledWith("connector", "workspace-git-worktree-v1");
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "create_git_worktree",
      target,
      path: "/srv/project/app",
      base,
      branch: "topic",
    });
    const discovery = { connectorId: "connector", transport: "ssh", sshAlias: "devbox" };
    expect(mocks.provisionAgentWorkspace).toHaveBeenCalledWith({
      userId: "owner",
      target: discovery,
      path: worktree.path,
      name: "topic",
      worktreeParentPath: "/srv/project/app",
      installations: [
        {
          provider: "codex",
          executable: "/usr/bin/codex",
          version: "1.2.3",
          shellMode: "login",
        },
      ],
    });
    expect(mocks.findOwnedAgentWorkspaceForTargetProvider).toHaveBeenCalledWith({
      userId: "owner",
      target: discovery,
      provider: "codex",
      path: worktree.path,
    });
  });

  it("nests a worktree of a worktree under the original workspace", async () => {
    mocks.getOwnedAgentWorkspace.mockResolvedValueOnce({
      host: { connectorId: "connector", transport: "local", sshAlias: null, userId: "owner" },
      connection: {
        id: "connection",
        provider: "claude",
        executable: "claude",
        detectedVersion: null,
        shellMode: "interactive",
      },
      workspace: { id: "workspace", path: "/wt/first", worktreeParentPath: "/srv/project" },
    });
    await POST(post({ base: { kind: "local", name: "first" }, branch: "second" }), context);
    expect(mocks.provisionAgentWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeParentPath: "/srv/project",
        installations: [expect.objectContaining({ version: "configured" })],
      }),
    );
  });

  it("deletes the new worktree when it cannot be added as a workspace", async () => {
    mocks.findOwnedAgentWorkspaceForTargetProvider.mockResolvedValueOnce(null);
    mocks.provisionAgentWorkspace.mockResolvedValueOnce({
      providers: 1,
      created: 0,
      refreshed: 0,
      failures: [{ provider: "codex", message: "codex is not installed" }],
    });
    const response = await POST(post({ base: { kind: "local", name: "main" }, branch: "topic" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "codex is not installed" });
    expect(mocks.daemonRequest).toHaveBeenLastCalledWith("connector", {
      type: "remove_git_worktree",
      target,
      path: worktree.path,
    });
  });

  it("relays Git errors and rejects malformed input before reaching the host", async () => {
    mocks.daemonRequest.mockRejectedValueOnce(new Error("A branch named topic already exists."));
    const failed = await POST(post({ base: { kind: "local", name: "main" }, branch: "topic" }), context);
    expect(failed.status).toBe(400);
    await expect(failed.json()).resolves.toEqual({ error: "A branch named topic already exists." });
    expect(mocks.provisionAgentWorkspace).not.toHaveBeenCalled();

    mocks.daemonRequest.mockClear();
    for (const body of [
      {},
      { base: { kind: "new", name: "main" }, branch: "topic" },
      { base: { kind: "local", name: "main" }, branch: "-x" },
    ]) {
      expect((await POST(post(body), context)).status).toBe(400);
    }
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("asks for a connector update and blocks non-admins", async () => {
    mocks.supports.mockReturnValueOnce(false);
    expect(
      (await POST(post({ base: { kind: "local", name: "main" }, branch: "topic" }), context)).status,
    ).toBe(426);
    mocks.getSession.mockResolvedValueOnce({ user: { id: "owner", role: "user" } });
    expect(
      (await POST(post({ base: { kind: "local", name: "main" }, branch: "topic" }), context)).status,
    ).toBe(403);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
