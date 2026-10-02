import { describe, expect, it } from "vitest";
import {
  HOST_CONNECTOR_EVENT_BATCH_BYTES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  type HostConnectorEvent,
} from "@overtchat/agent-bridge";
import { boundedEventBatch } from "./event-batch.js";

function reply(sequence: number, bytes: number): HostConnectorEvent {
  return {
    sequence,
    payload: {
      type: "response",
      requestId: `request-${sequence}`,
      success: true,
      data: { snapshot: "x".repeat(bytes) },
    },
  };
}

describe("connector event byte budget", () => {
  it("drains the production-shaped backlog without exceeding the proxy buffer or skipping sequences", () => {
    let pending = Array.from({ length: 10 }, (_, index) =>
      reply(533318 + index, 6_565_400),
    );
    const sequences: number[] = [];
    let requests = 0;
    while (pending.length) {
      const batch = boundedEventBatch(pending);
      const body = JSON.stringify({
        protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
        connectorEpoch: "epoch",
        events: batch,
      });
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(
        HOST_CONNECTOR_EVENT_BATCH_BYTES,
      );
      sequences.push(...batch.map((event) => event.sequence));
      pending = pending.slice(batch.length);
      requests++;
    }
    expect(requests).toBe(10);
    expect(sequences).toEqual(
      Array.from({ length: 10 }, (_, index) => 533318 + index),
    );
  });

  it("counts UTF-8 and JSON escaping, and retains a single oversized event for fragmentation", () => {
    const huge = reply(1, 10 * 1024 * 1024);
    expect(boundedEventBatch([huge, reply(2, 1)])).toEqual([huge]);
    const unicode = {
      sequence: 1,
      payload: {
        type: "response",
        requestId: "utf8",
        success: true,
        data: "😀\n".repeat(800_000),
      },
    } as const;
    const batch = boundedEventBatch([unicode, unicode, reply(3, 1)]);
    expect(batch).toHaveLength(1);
    expect(
      boundedEventBatch(
        Array.from({ length: 300 }, (_, index) => reply(index + 1, 1)),
      ),
    ).toHaveLength(256);
  });
});
