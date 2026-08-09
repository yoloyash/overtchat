import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  HOST_CONNECTOR_PROTOCOL_VERSION,
} from "@overtchat/agent-bridge";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  accept: vi.fn(),
  touch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/connector/auth", () => ({
  authenticateHostConnector: mocks.authenticate,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    accept: mocks.accept,
  },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  touchHostConnector: mocks.touch,
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://server.test/api/host-connectors/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Host Connector event route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockReturnValue({ id: "connector" });
  });

  it("accepts validated connector events", async () => {
    const event = {
      type: "stdout",
      processId: "process",
      data: Buffer.from("hello").toString("base64"),
    };
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        events: [event],
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.accept).toHaveBeenCalledWith("connector", event);
    expect(mocks.touch).toHaveBeenCalledWith("connector");
  });

  it("rejects malformed events before they reach the broker", async () => {
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        events: [null],
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("rejects event batches above the shared connector limit", async () => {
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        events: Array.from(
          { length: HOST_CONNECTOR_EVENT_BATCH_LIMIT + 1 },
          (_, index) => ({
            type: "stdout",
            processId: "process",
            data: String(index),
          }),
        ),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("rejects unsupported connector protocol versions", async () => {
    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION + 1,
        events: [],
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("requires a connector credential", async () => {
    mocks.authenticate.mockReturnValue(null);

    const response = await POST(
      request({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        events: [],
      }),
    );

    expect(response.status).toBe(401);
  });
});
