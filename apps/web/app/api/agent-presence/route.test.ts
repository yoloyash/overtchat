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

  it("rejects signed-out users, members and malformed heartbeats", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await POST(request({}))).status).toBe(401);
    mocks.getSession.mockResolvedValueOnce({ user: { id: "member", role: "user" } });
    expect(
      (await POST(request({ clientId: "tab-00000002", visible: true, viewing: null, notify: true }))).status,
    ).toBe(403);
    for (const body of [
      null,
      { clientId: "short", visible: true, viewing: null, notify: true },
      { clientId: "tab-00000003", visible: "yes", viewing: null, notify: true },
      { clientId: "tab-00000003", visible: true, viewing: "", notify: true },
      { clientId: "tab-00000003", visible: true, viewing: null },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(agentClientRegistry.clients("member")).toEqual([]);
  });
});
