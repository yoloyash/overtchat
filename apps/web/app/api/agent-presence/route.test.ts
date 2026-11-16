import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

import { agentClientRegistry } from "@/lib/notifications/presence";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://server.test/api/agent-presence", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("agent presence heartbeats", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner", role: "admin" } });
  });

  it("records an admin's client and what it shows", async () => {
    const response = await POST(
      request({ clientId: "tab-00000001", visible: true, viewing: "session", notify: true }),
    );
    expect(response.status).toBe(204);
    expect(agentClientRegistry.clients("owner")).toEqual([
      expect.objectContaining({ clientId: "tab-00000001", visible: true, viewing: "session" }),
    ]);
  });

  it("takes how long the client sat idle", async () => {
    const before = Date.now();
    const response = await POST(
      request({ clientId: "tab-00000001", visible: true, viewing: null, notify: true, idleMs: 60_000 }),
    );
    expect(response.status).toBe(204);
    const [client] = agentClientRegistry.clients("owner");
    expect(client?.activeAt).toBeLessThanOrEqual(Date.now() - 60_000);
    expect(client?.activeAt).toBeGreaterThanOrEqual(before - 60_000);
  });

  it("records a member's client too, for their chats", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { id: "member", role: "user" } });
    const response = await POST(
      request({ clientId: "tab-00000002", visible: true, viewing: "chat:one", notify: true }),
    );
    expect(response.status).toBe(204);
    expect(agentClientRegistry.clients("member")).toEqual([
      expect.objectContaining({ clientId: "tab-00000002", viewing: "chat:one", alerts: true }),
    ]);
  });

  it("rejects signed-out users and malformed heartbeats", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await POST(request({}))).status).toBe(401);
    for (const body of [
      null,
      { clientId: "short", visible: true, viewing: null, notify: true },
      { clientId: "tab-00000003", visible: "yes", viewing: null, notify: true },
      { clientId: "tab-00000003", visible: true, viewing: "", notify: true },
      { clientId: "tab-00000003", visible: true, viewing: null },
      { clientId: "tab-00000003", visible: true, viewing: null, notify: true, idleMs: -1 },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(agentClientRegistry.clients("owner").map((client) => client.clientId)).not.toContain(
      "tab-00000003",
    );
  });
});
