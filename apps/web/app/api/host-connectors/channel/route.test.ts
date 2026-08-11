import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_PROTOCOL_VERSION,
  HOST_CONNECTOR_RELEASE_VERSION,
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

function request(version: string, protocol: number): Request {
  return new Request("http://server.test/api/host-connectors/channel", {
    headers: {
      "X-OvertChat-Connector-Version": version,
      "X-OvertChat-Connector-Protocol": String(protocol),
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

  it("opens only for the exact connector release and protocol", async () => {
    const response = await GET(
      request(HOST_CONNECTOR_RELEASE_VERSION, HOST_CONNECTOR_PROTOCOL_VERSION),
    );

    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"type":"sync"');
    expect(mocks.register).toHaveBeenCalledWith(
      "connector",
      ["session"],
      expect.any(Function),
    );
    expect(mocks.touch).toHaveBeenCalledWith(
      "connector",
      HOST_CONNECTOR_RELEASE_VERSION,
    );
    await reader.cancel();
    expect(mocks.unregister).toHaveBeenCalled();
  });

  it("rejects any other release or protocol without opening a channel", async () => {
    const wrongRelease = await GET(
      request("9.9.9", HOST_CONNECTOR_PROTOCOL_VERSION),
    );
    expect(wrongRelease.status).toBe(409);

    const wrongProtocol = await GET(
      request(
        HOST_CONNECTOR_RELEASE_VERSION,
        HOST_CONNECTOR_PROTOCOL_VERSION + 1,
      ),
    );
    expect(wrongProtocol.status).toBe(409);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("requires a connector credential", async () => {
    mocks.authenticate.mockReturnValue(null);

    const response = await GET(
      request(HOST_CONNECTOR_RELEASE_VERSION, HOST_CONNECTOR_PROTOCOL_VERSION),
    );

    expect(response.status).toBe(401);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
