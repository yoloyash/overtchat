import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  changeUserRole: vi.fn(),
  daemonRequest: vi.fn(),
  listConnectors: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/users", () => ({
  changeUserRole: mocks.changeUserRole,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { request: mocks.daemonRequest },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  listHostConnectors: mocks.listConnectors,
}));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ id: "target" }) };

function request(role: string): Request {
  return new Request("http://server.test/api/users/target/role", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

describe("user role route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.changeUserRole.mockReturnValue({
      status: "updated",
      user: {
        id: "target",
        name: "Target",
        email: "target@example.com",
        role: "user",
      },
    });
    mocks.listConnectors.mockReturnValue([{ id: "connector" }]);
  });

  it("requires an administrator", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    expect((await PATCH(request("admin"), context)).status).toBe(403);
    expect(mocks.changeUserRole).not.toHaveBeenCalled();
  });

  it("stops agent runtimes after demotion", async () => {
    const response = await PATCH(request("user"), context);

    expect(response.status).toBe(200);
    expect(mocks.changeUserRole).toHaveBeenCalledWith(
      "admin",
      "target",
      "user",
    );
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "stop_all",
    });
  });

  it("surfaces role-change safeguards", async () => {
    mocks.changeUserRole.mockReturnValue({ status: "last_admin" });

    const response = await PATCH(request("user"), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "At least one administrator is required.",
    });
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
