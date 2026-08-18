import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  daemonRequest: vi.fn(),
  upsertAgentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentWorkspace: mocks.getOwnedAgentWorkspace,
  upsertAgentSession: mocks.upsertAgentSession,
}));
vi.mock("@/lib/agents/connector/broker", () => ({ hostConnectorBroker: { request: mocks.daemonRequest } }));

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
    mocks.daemonRequest.mockResolvedValue({
      session: {
        providerSessionId: "native",
        providerSessionPath: "/sessions/native.jsonl",
        name: null,
        firstMessage: null,
        messageCount: 0,
        createdAt: null,
        modifiedAt: null,
      },
      launchConfig: {
        model: "vllm/qwen",
        thinkingOptionId: "high",
        modeId: "ask",
      },
      snapshot: { sessionId: "created", status: "idle" },
    });
    mocks.upsertAgentSession.mockResolvedValue({ id: "created" });
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
    expect(mocks.daemonRequest).toHaveBeenCalledWith(
      "connector",
      expect.objectContaining({ type: "create_session", launchConfig }),
    );
    expect(mocks.upsertAgentSession).toHaveBeenCalledWith(
      "workspace",
      expect.objectContaining({ providerSessionId: "native" }),
      expect.any(String),
      launchConfig,
    );
  });

  it("rejects invalid launch configuration before contacting the connector", async () => {
    const response = await POST(
      new Request("http://server.test/api/agent-workspaces/workspace/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thinkingOptionId: "ultra" }),
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
