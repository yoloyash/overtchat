import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
} from "@overtchat/agent-bridge";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  touch: vi.fn(),
  listActiveSessions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/connector/auth", () => ({
  authenticateHostConnector: mocks.authenticate,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { register: mocks.register },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  touchHostConnector: mocks.touch,
}));
vi.mock("@/lib/db/agentConnections", () => ({
  listActiveAgentSessionIds: mocks.listActiveSessions,
}));

import { GET } from "./route";

function request(
  version = HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
  protocol = HOST_CONNECTOR_PROTOCOL_VERSION,
  options: { buildVersion?: string; capabilities?: string } = {},
): Request {
  return new Request("http://server.test/api/host-connectors/channel", {
    headers: {
      "X-OvertChat-Connector-Version": version,
      "X-OvertChat-Connector-Protocol": String(protocol),
      ...(options.buildVersion
        ? { "X-OvertChat-Connector-Build-Version": options.buildVersion }
        : {}),
      ...(options.capabilities
        ? { "X-OvertChat-Connector-Capabilities": options.capabilities }
        : {}),
    },
  });
}

describe("Host Connector command channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockReturnValue({ id: "connector" });
    mocks.register.mockImplementation(
      (
        _connectorId: string,
        _activeSessionIds: string[],
        send: (value: unknown) => void,
      ) => {
        send({
          type: "sync",
          connectionEpoch: "connection",
          activeSessionIds: ["session"],
        });
        return mocks.unregister;
      },
    );
    mocks.listActiveSessions.mockResolvedValue(["session"]);
  });

  it("opens for the protocol-1 compatibility baseline", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"type":"sync"');
    expect(mocks.register).toHaveBeenCalledWith(
      "connector",
      ["session"],
      expect.any(Function),
      [],
    );
    expect(mocks.touch).toHaveBeenCalledWith(
      "connector",
      HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
    );
    await reader.cancel();
    expect(mocks.unregister).toHaveBeenCalled();
  });

  it("uses the build version for display without gating the wire", async () => {
    const response = await GET(
      request(
        HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
        HOST_CONNECTOR_PROTOCOL_VERSION,
        {
          buildVersion: "9.9.9",
          capabilities: `${HOST_CONNECTOR_CAPABILITIES[0]},future-capability`,
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(
      "connector",
      ["session"],
      expect.any(Function),
      [HOST_CONNECTOR_CAPABILITIES[0]],
    );
    expect(mocks.touch).toHaveBeenCalledWith("connector", "9.9.9");
    await response.body!.cancel();
  });

  it("rejects an incompatible wire shape or protocol", async () => {
    const wrongRelease = await GET(request("0.1.0"));
    expect(wrongRelease.status).toBe(409);
    await expect(wrongRelease.json()).resolves.toMatchObject({
      code: "unsupported_connector_protocol",
      compatibilityRelease: HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
    });

    const wrongProtocol = await GET(
      request(
        HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
        HOST_CONNECTOR_PROTOCOL_VERSION + 1,
      ),
    );
    expect(wrongProtocol.status).toBe(409);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("requires a connector credential", async () => {
    mocks.authenticate.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
