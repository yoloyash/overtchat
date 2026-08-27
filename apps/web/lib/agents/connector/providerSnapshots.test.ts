import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  findConnection: vi.fn(),
  findWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
  listConnections: vi.fn(),
  saveInstallation: vi.fn(),
  syncSessions: vi.fn(),
  upsertSession: vi.fn(),
  updateRuntime: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./broker", () => ({
  hostConnectorBroker: { request: mocks.request },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  findOwnedAgentConnectionForTargetProvider: mocks.findConnection,
  findOwnedAgentWorkspaceForTargetProvider: mocks.findWorkspace,
  getOwnedAgentWorkspace: mocks.getWorkspace,
  listAgentConnections: mocks.listConnections,
  saveAgentWorkspaceInstallation: mocks.saveInstallation,
  syncAgentWorkspaceSessions: mocks.syncSessions,
  upsertAgentSession: mocks.upsertSession,
  updateAgentConnectionRuntime: mocks.updateRuntime,
}));

import {
  createAgentWorkspaceProviderSession,
  getAgentProviderSnapshot,
  refreshAgentWorkspaces,
  resolveAgentWorkspaceProvider,
} from "./providerSnapshots";

const target = { connectorId: "connector", transport: "local" as const };
const snapshot = {
  target,
  providers: [
    { provider: "pi" as const, status: "unavailable" as const },
    { provider: "omp" as const, status: "unavailable" as const },
    { provider: "codex" as const, status: "unavailable" as const },
    {
      provider: "opencode" as const,
      status: "ready" as const,
      executable: "/usr/local/bin/opencode",
      version: "1.2.3",
      shellMode: "interactive" as const,
    },
  ],
  refreshedAt: 123,
};
const anchor = {
  host: {
    id: "host",
    userId: "owner",
    connectorId: "connector",
    name: "This server",
    transport: "local" as const,
    sshAlias: null,
  },
  connection: {
    id: "pi-connection",
    hostId: "host",
    provider: "pi",
    executable: "pi",
    shellMode: "interactive" as const,
    detectedVersion: "1.0.0",
  },
  workspace: {
    id: "pi-workspace",
    connectionId: "pi-connection",
    path: "/work/project",
    name: "project",
  },
};
const connectionList = [
  {
    id: "pi-connection",
    provider: "pi" as const,
    executable: "pi",
    detectedVersion: "1.0.0",
    lastValidatedAt: null,
    host: {
      id: "host",
      connectorId: "connector",
      name: "This server",
      transport: "local" as const,
      sshAlias: null,
    },
    workspaces: [
      {
        id: "pi-workspace",
        path: "/work/project",
        name: "project",
        sessions: [],
      },
    ],
  },
];

describe("connector provider snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockResolvedValue(anchor);
    mocks.findConnection.mockResolvedValue(null);
    mocks.findWorkspace.mockResolvedValue(null);
    mocks.listConnections.mockResolvedValue(connectionList);
    mocks.saveInstallation.mockReturnValue({});
    mocks.syncSessions.mockReturnValue([]);
    mocks.updateRuntime.mockResolvedValue(true);
    mocks.upsertSession.mockResolvedValue({});
  });

  it("reads a connector-owned snapshot without touching persistence", async () => {
    mocks.request.mockResolvedValue(snapshot);

    await expect(getAgentProviderSnapshot(target)).resolves.toEqual(snapshot);

    expect(mocks.request).toHaveBeenCalledWith("connector", {
      type: "provider_snapshot",
      target,
      refresh: undefined,
    });
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.findWorkspace).not.toHaveBeenCalled();
    expect(mocks.saveInstallation).not.toHaveBeenCalled();
  });

  it("projects a ready provider onto an existing workspace without a backing row", async () => {
    mocks.request.mockResolvedValue(snapshot);

    const resolved = await resolveAgentWorkspaceProvider({
      userId: "owner",
      anchorWorkspaceId: "pi-workspace",
      provider: "opencode",
    });

    expect(resolved.backing).toBeNull();
    expect(resolved.descriptor).toMatchObject({
      provider: "opencode",
      executable: "/usr/local/bin/opencode",
      cwd: "/work/project",
      target: { transport: "local", shellMode: "interactive" },
    });
    expect(mocks.saveInstallation).not.toHaveBeenCalled();
  });

  it("does not materialize a newly detected provider with no sessions", async () => {
    mocks.request
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce([]);

    await expect(refreshAgentWorkspaces("owner")).resolves.toMatchObject({
      providers: 1,
      created: 0,
      refreshed: 0,
      failures: [],
    });

    expect(mocks.saveInstallation).not.toHaveBeenCalled();
  });

  it("materializes a newly detected provider when refresh finds durable sessions", async () => {
    mocks.request
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce([
        {
          providerSessionId: "native",
          providerSessionPath: "native",
          name: "Imported session",
          firstMessage: "Hello",
          messageCount: 2,
          createdAt: 1,
          modifiedAt: 2,
          launchConfig: { model: "openai/gpt-5" },
        },
      ]);

    await expect(refreshAgentWorkspaces("owner")).resolves.toMatchObject({
      providers: 1,
      created: 1,
      refreshed: 0,
      failures: [],
    });

    expect(mocks.saveInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ provider: "opencode" }),
        workspace: { path: "/work/project", name: "project" },
        sessions: [
          expect.objectContaining({
            providerSessionId: "native",
            launchConfig: { model: "openai/gpt-5" },
          }),
        ],
      }),
    );
  });

  it("materializes a virtual provider only after its runtime session exists", async () => {
    mocks.request
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({
        session: {
          providerSessionId: "native",
          providerSessionPath: "native",
          name: null,
          firstMessage: null,
          messageCount: 0,
          createdAt: null,
          modifiedAt: null,
        },
        launchConfig: { model: "openai/gpt-5" },
        snapshot: { sessionId: "runtime", status: "idle" },
      });

    await expect(
      createAgentWorkspaceProviderSession({
        userId: "owner",
        anchorWorkspaceId: "pi-workspace",
        provider: "opencode",
        launchConfig: { model: "openai/gpt-5" },
      }),
    ).resolves.toMatchObject({ session: { id: expect.any(String) } });

    expect(mocks.saveInstallation).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[1]?.[1]).toMatchObject({
      type: "create_session",
      workspace: { provider: "opencode", cwd: "/work/project" },
    });
  });
});
