import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  HOST_CONNECTOR_RELEASE_VERSION,
} from "@overtchat/agent-bridge";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  acceptBatch: vi.fn(),
  touch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/connector/auth", () => ({
  authenticateHostConnector: mocks.authenticate,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    acceptBatch: mocks.acceptBatch,
  },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  touchHostConnector: mocks.touch,
}));

import { POST } from "./route";

function request(
  body: unknown,
  version = HOST_CONNECTOR_RELEASE_VERSION,
): Request {
  return new Request("http://server.test/api/host-connectors/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OvertChat-Connector-Version": version,
      "X-OvertChat-Connector-Protocol": String(
        HOST_CONNECTOR_PROTOCOL_VERSION,
      ),
    },
    body: JSON.stringify(body),
  });
}

describe("Host Connector event route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockReturnValue({ id: "connector" });
    mocks.acceptBatch.mockReturnValue({
      connectorEpoch: "daemon",
      acknowledgedSequence: 1,
    });
  });

  it("accepts validated connector events", async () => {
    const event = {
      sequence: 1,
      payload: {
        type: "response",
        requestId: "request",
        success: true,
        data: "hello",
      },
    };
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        connectorEpoch: "daemon",
        events: [event],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connectorEpoch: "daemon",
      acknowledgedSequence: 1,
    });
    expect(mocks.acceptBatch).toHaveBeenCalledWith(
      "connector",
      "daemon",
      [event],
    );
    expect(mocks.touch).toHaveBeenCalledWith("connector");
  });

  it("rejects malformed events before they reach the broker", async () => {
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        connectorEpoch: "daemon",
        events: [null],
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.acceptBatch).not.toHaveBeenCalled();
  });

  it("rejects event batches above the shared connector limit", async () => {
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        connectorEpoch: "daemon",
        events: Array.from(
          { length: HOST_CONNECTOR_EVENT_BATCH_LIMIT + 1 },
          (_, index) => ({
            sequence: index + 1,
            payload: {
              type: "response",
              requestId: String(index),
              success: true,
              data: index,
            },
          }),
        ),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.acceptBatch).not.toHaveBeenCalled();
  });

  it("rejects unsupported connector protocol versions", async () => {
    const response = await POST(new Request(
      "http://server.test/api/host-connectors/events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OvertChat-Connector-Version": HOST_CONNECTOR_RELEASE_VERSION,
          "X-OvertChat-Connector-Protocol": String(
            HOST_CONNECTOR_PROTOCOL_VERSION + 1,
          ),
        },
        body: JSON.stringify({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION + 1,
        connectorEpoch: "daemon",
        events: [],
        }),
      },
    ));

    expect(response.status).toBe(409);
    expect(mocks.acceptBatch).not.toHaveBeenCalled();
  });

  it("rejects a different connector release", async () => {
    const response = await POST(
      request(
        {
          protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
          connectorEpoch: "daemon",
          events: [],
        },
        "9.9.9",
      ),
    );

    expect(response.status).toBe(409);
    expect(mocks.acceptBatch).not.toHaveBeenCalled();
  });

  it("requires a connector credential", async () => {
    mocks.authenticate.mockReturnValue(null);

    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        connectorEpoch: "daemon",
        events: [],
      }),
    );

    expect(response.status).toBe(401);
  });
});
