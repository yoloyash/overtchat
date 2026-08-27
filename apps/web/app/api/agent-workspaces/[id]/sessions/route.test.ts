import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  createProviderSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentWorkspace: mocks.getOwnedAgentWorkspace,
}));
vi.mock("@/lib/agents/connector/providerSnapshots", () => ({
  createAgentWorkspaceProviderSession: mocks.createProviderSession,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "workspace" }) };
const owned = {
  host: { connectorId: "connector", transport: "local", userId: "owner" },
  connection: {
    id: "connection",
    provider: "omp",
    executable: "omp",
    shellMode: "interactive",
    detectedVersion: "17.2.15",
  },
  workspace: { id: "workspace", path: "/workspace" },
};

describe("create agent workspace session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "owner", role: "admin" } });
    mocks.getOwnedAgentWorkspace.mockResolvedValue(owned);
    mocks.createProviderSession.mockResolvedValue({
      session: { id: "created" },
      launchConfig: {
        model: "vllm/qwen",
        thinkingOptionId: "high",
        modeId: "ask",
      },
      snapshot: { sessionId: "created", status: "idle" },
    });
  });

  it("sends and persists the connector-resolved launch tuple", async () => {
    const launchConfig = {
      model: "vllm/qwen",
      thinkingOptionId: "high",
      modeId: "ask",
    } as const;
    const response = await POST(
      new Request("http://server.test/api/agent-workspaces/workspace/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(launchConfig),
      }),
      context,
    );
    expect(response.status).toBe(201);
    expect(mocks.createProviderSession).toHaveBeenCalledWith({
      userId: "owner",
      anchorWorkspaceId: "workspace",
      provider: "omp",
      launchConfig,
    });
  });

  it("starts a detected provider through an existing workspace anchor", async () => {
    const response = await POST(
      new Request("http://server.test/api/agent-workspaces/workspace/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "opencode",
          launchConfig: { model: "openai/gpt-5" },
        }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mocks.createProviderSession).toHaveBeenCalledWith({
      userId: "owner",
      anchorWorkspaceId: "workspace",
      provider: "opencode",
      launchConfig: { model: "openai/gpt-5" },
    });
  });

  it("rejects invalid launch configuration before contacting the connector", async () => {
    const response = await POST(
      new Request("http://server.test/api/agent-workspaces/workspace/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thinkingOptionId: "x".repeat(121) }),
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.createProviderSession).not.toHaveBeenCalled();
  });
});
