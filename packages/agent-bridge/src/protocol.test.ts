import { describe, expect, it } from "vitest";
import {
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorCommand,
  isHostConnectorEvent,
  parseHostConnectorCapabilities,
} from "./index";
import { agentProviderCatalogSchema } from "./agents";

describe("Host Connector protocol compatibility", () => {
  it("identifies the current wire protocol", () => {
    expect(HOST_CONNECTOR_PROTOCOL_VERSION).toBe(3);
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
          protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
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

  it("accepts a session-directory snapshot and provider-independent upserts", () => {
    expect(
      isHostConnectorEvent({
        sequence: 1,
        payload: {
          type: "session_directory",
          sessions: [
            { sessionId: "session", runtimeStatus: "running" },
          ],
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorEvent({
        sequence: 2,
        payload: {
          type: "session_update",
          session: { sessionId: "session", runtimeStatus: "idle" },
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorEvent({
        sequence: 3,
        payload: {
          type: "session_directory",
          sessions: [
            { sessionId: "session", runtimeStatus: "idle" },
            { sessionId: "session", runtimeStatus: "running" },
          ],
        },
      }),
    ).toBe(false);
  });

  it("validates provider catalogs at the connector boundary", () => {
    const catalog = {
      provider: "omp",
      models: [
        {
          provider: "omp",
          id: "openai/gpt-5",
          label: "GPT-5",
          api: "openai-responses",
          baseUrl: "",
          reasoning: true,
          input: ["text"],
          contextWindow: null,
          maxTokens: null,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      modes: [{ id: "full", label: "Full Access", description: "Yolo" }],
      defaultModeId: "full",
    };
    expect(agentProviderCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(
      agentProviderCatalogSchema.safeParse({
        ...catalog,
        models: [{ ...catalog.models[0], provider: "pi" }],
      }).success,
    ).toBe(false);
  });
});
