import { describe, expect, it } from "vitest";
import {
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE,
  isHostConnectorCommand,
  isHostConnectorEvent,
  parseHostConnectorCapabilities,
} from "./index";

describe("Host Connector protocol compatibility", () => {
  it("keeps the agent-daemon v1 compatibility token independent of builds", () => {
    expect(HOST_CONNECTOR_V1_COMPATIBILITY_RELEASE).toBe("0.2.0");
  });

  it("selects known capabilities and ignores unknown additive tokens", () => {
    expect(
      parseHostConnectorCapabilities(
        ` ${HOST_CONNECTOR_CAPABILITIES[0]},future-capability,${HOST_CONNECTOR_CAPABILITIES[0]} `,
      ),
    ).toEqual([HOST_CONNECTOR_CAPABILITIES[0]]);
    expect(
      parseHostConnectorCapabilities(HOST_CONNECTOR_CAPABILITIES.join(",")),
    ).toEqual(HOST_CONNECTOR_CAPABILITIES);
    expect(parseHostConnectorCapabilities(null)).toEqual([]);
  });

  it("accepts optional server information on the legacy sync command", () => {
    expect(
      isHostConnectorCommand({
        type: "sync",
        connectionEpoch: "connection",
        activeSessionIds: [],
        serverInfo: {
          protocolVersion: 1,
          capabilities: [...HOST_CONNECTOR_CAPABILITIES, "future-capability"],
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorCommand({
        type: "sync",
        connectionEpoch: "connection",
        activeSessionIds: [],
      }),
    ).toBe(true);
  });

  it("accepts provider-independent session status events", () => {
    expect(
      isHostConnectorEvent({
        sequence: 1,
        payload: {
          type: "session_status",
          sessionId: "session",
          status: "running",
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorEvent({
        sequence: 1,
        payload: {
          type: "session_status",
          sessionId: "session",
          status: "working",
        },
      }),
    ).toBe(false);
  });
});
