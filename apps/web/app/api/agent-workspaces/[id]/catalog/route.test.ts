import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentWorkspace: vi.fn(),
  daemonRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/db/agentConnections", () => ({ getOwnedAgentWorkspace: mocks.getOwnedAgentWorkspace }));
vi.mock("@/lib/agents/connector/broker", () => ({ hostConnectorBroker: { request: mocks.daemonRequest } }));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "workspace" }) };
const request = new Request("http://server.test/api/agent-workspaces/workspace/catalog");

describe("agent workspace catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "owner", role: "admin" } });
    mocks.getOwnedAgentWorkspace.mockResolvedValue({
      host: { connectorId: "connector", transport: "local", userId: "owner" },
      connection: {
        id: "connection",
        provider: "omp",
        executable: "omp",
        shellMode: "interactive",
        detectedVersion: "17.2.15",
      },
      workspace: { id: "workspace", path: "/workspace" },
    });
    mocks.daemonRequest.mockResolvedValue({
      provider: "omp",
      models: [
        {
          id: "vllm/qwen",
          label: "Qwen",
          provider: "omp",
          api: "openai-completions",
          baseUrl: "",
          reasoning: true,
          input: ["text"],
          contextWindow: null,
          maxTokens: null,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      modes: [{ id: "full", label: "Full Access", description: "No prompts" }],
      defaultModeId: "full",
    });
  });

  it("returns the connector-owned provider catalog", async () => {
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "get_catalog",
      workspace: {
        connectionId: "connection",
        workspaceId: "workspace",
        provider: "omp",
        target: { transport: "local", shellMode: "interactive" },
        executable: "omp",
        cwd: "/workspace",
        detectedVersion: "17.2.15",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      provider: "omp",
      defaultModeId: "full",
    });
  });

  it("enforces authentication and ownership", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(request, context)).status).toBe(401);
    mocks.getSession.mockResolvedValueOnce({ user: { id: "owner", role: "user" } });
    expect((await GET(request, context)).status).toBe(403);
    mocks.getOwnedAgentWorkspace.mockResolvedValueOnce(null);
    expect((await GET(request, context)).status).toBe(404);
  });

  it("rejects a catalog for a different provider", async () => {
    mocks.daemonRequest.mockResolvedValueOnce({
      provider: "pi",
      models: [
        {
          id: "openai/gpt-5",
          label: "GPT-5",
          provider: "pi",
          api: "openai-responses",
          baseUrl: "",
          reasoning: true,
          input: ["text"],
          contextWindow: null,
          maxTokens: null,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      modes: [],
      defaultModeId: null,
    });
    const response = await GET(request, context);
    expect(response.status).toBe(400);
  });
});
