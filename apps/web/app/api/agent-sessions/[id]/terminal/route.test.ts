import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), owned: vi.fn(), issue: vi.fn(), isOnline: vi.fn(), supports: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/db/agentConnections", () => ({ getOwnedAgentSession: mocks.owned }));
vi.mock("@/lib/agents/terminal/server", () => ({ terminalRelay: { issue: mocks.issue } }));
vi.mock("@/lib/agents/connector/broker", () => ({ hostConnectorBroker: { isOnline: mocks.isOnline, supports: mocks.supports } }));
import { POST } from "./route";

const session = { user: { id: "owner", role: "admin" }, session: { id: "login" } };
const owned = {
  host: { connectorId: "connector", transport: "local", sshAlias: null },
  connection: { id: "connection", provider: "codex", executable: "codex", shellMode: "login" },
  workspace: { id: "workspace", path: "/workspace" },
};
const context = { params: Promise.resolve({ id: "session" }) };
const request = (body: unknown = { cols: 80, rows: 24 }, origin = "https://server.test") =>
  new Request("https://server.test/api/agent-sessions/session/terminal", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  });

describe("terminal attachment tickets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue(session);
    mocks.owned.mockResolvedValue(owned);
    mocks.issue.mockReturnValue("one-use-ticket");
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
  });
  it("requires administrator access and the owned session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(401);
    mocks.getSession.mockResolvedValueOnce({ ...session, user: { id: "owner", role: "user" } });
    expect((await POST(request(), context)).status).toBe(403);
    mocks.owned.mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.owned).toHaveBeenCalledWith("session", "owner");
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("rejects invalid dimensions before allocating a ticket", async () => {
    for (const value of [null, {}, { cols: 80, rows: 0 }, { cols: 1001, rows: 24 }]) {
      expect((await POST(request(value), context)).status).toBe(400);
    }
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("binds desktop tickets to their origin and rechecks session, role, and workspace", async () => {
    const response = await POST(request(undefined, "overtchat://app"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const grant = mocks.issue.mock.calls[0]![0];
    expect(grant).toMatchObject({ connectorId: "connector", origin: "overtchat://app", workspace: { workspaceId: "workspace", cwd: "/workspace" } });
    expect(await grant.authorize()).toBe(true);
    mocks.getSession.mockResolvedValueOnce(null);
    expect(await grant.authorize()).toBe(false);
    mocks.getSession.mockResolvedValueOnce({ ...session, session: { id: "different-login" } });
    expect(await grant.authorize()).toBe(false);
    mocks.getSession.mockResolvedValueOnce({ ...session, user: { id: "owner", role: "user" } });
    expect(await grant.authorize()).toBe(false);
    mocks.owned.mockResolvedValueOnce({ ...owned, workspace: { ...owned.workspace, path: "/moved" } });
    expect(await grant.authorize()).toBe(false);
    mocks.owned.mockResolvedValueOnce({ ...owned, host: { ...owned.host, connectorId: "other" } });
    expect(await grant.authorize()).toBe(false);
  });
  it("reports an unavailable channel without issuing a working ticket", async () => {
    mocks.issue.mockImplementation(() => { throw new Error("Terminal channel offline."); });
    expect((await POST(request(), context)).status).toBe(503);
  });
  it("explains missing terminal capability without repeatedly retrying", async () => {
    mocks.supports.mockReturnValue(false);
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
