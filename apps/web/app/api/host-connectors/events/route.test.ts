import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
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
  options: {
    version?: string;
    protocol?: number;
    buildVersion?: string;
  } = {},
): Request {
  return new Request("http://server.test/api/host-connectors/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OvertChat-Connector-Version":
        options.version ?? HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
      "X-OvertChat-Connector-Protocol": String(
        options.protocol ?? HOST_CONNECTOR_PROTOCOL_VERSION,
      ),
      ...(options.buildVersion
        ? { "X-OvertChat-Connector-Build-Version": options.buildVersion }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("Host Connector event route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockReturnValue({ id: "connector" });
    mocks.acceptBatch.mockResolvedValue({
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
    expect(mocks.touch).toHaveBeenCalledWith(
      "connector",
      HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
    );
  });

  it("records a newer build without requiring its release to match", async () => {
    const response = await POST(
      request(
        {
          protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
          connectorEpoch: "daemon",
          events: [
            {
              sequence: 1,
              payload: {
                type: "response",
                requestId: "request",
                success: true,
                data: null,
              },
            },
          ],
        },
        { buildVersion: "9.9.9" },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.touch).toHaveBeenCalledWith("connector", "9.9.9");
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

  it("rejects empty event batches", async () => {
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        connectorEpoch: "daemon",
        events: [],
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.acceptBatch).not.toHaveBeenCalled();
  });

  it("rejects unsupported connector protocol versions", async () => {
    const response = await POST(
      request(
        {
          protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION + 1,
          connectorEpoch: "daemon",
          events: [
            {
              sequence: 1,
              payload: {
                type: "response",
                requestId: "request",
                success: true,
                data: null,
              },
            },
          ],
        },
        { protocol: HOST_CONNECTOR_PROTOCOL_VERSION + 1 },
      ),
    );

    expect(response.status).toBe(409);
    expect(mocks.acceptBatch).not.toHaveBeenCalled();
  });

  it("rejects an outdated connector release with an update instruction", async () => {
    const response = await POST(
      request(
        {
          protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
          connectorEpoch: "daemon",
          events: [
            {
              sequence: 1,
              payload: {
                type: "response",
                requestId: "request",
                success: true,
                data: null,
              },
            },
          ],
        },
        { version: "0.1.0" },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("overtchat update"),
      code: "unsupported_connector_protocol",
      compatibilityRelease: HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
    });
    expect(mocks.acceptBatch).not.toHaveBeenCalled();
  });

  it("returns a client error when the broker rejects a noncontiguous batch", async () => {
    mocks.acceptBatch.mockRejectedValueOnce(
      new Error("The Host Connector event batch is not contiguous."),
    );
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        connectorEpoch: "daemon",
        events: [
          {
            sequence: 4,
            payload: {
              type: "response",
              requestId: "request-1",
              success: true,
              data: null,
            },
          },
          {
            sequence: 6,
            payload: {
              type: "response",
              requestId: "request-2",
              success: true,
              data: null,
            },
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The Host Connector event batch is not contiguous.",
    });
    expect(mocks.touch).not.toHaveBeenCalled();
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
