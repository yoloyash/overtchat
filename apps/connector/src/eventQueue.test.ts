import { HOST_CONNECTOR_EVENT_BATCH_LIMIT } from "@overtchat/agent-bridge";
import { describe, expect, it } from "vitest";
import type { HostConnectorEvent } from "@overtchat/agent-bridge";
import {
  restoreConnectorEventBatch,
  takeConnectorEventBatch,
} from "./eventQueue.js";

function event(index: number): HostConnectorEvent {
  return {
    type: "stdout",
    processId: "process",
    data: String(index),
  };
}

describe("connector event queue", () => {
  it("splits backlogs into server-sized batches", () => {
    const queue = Array.from(
      { length: HOST_CONNECTOR_EVENT_BATCH_LIMIT + 1 },
      (_, index) => event(index),
    );

    const first = takeConnectorEventBatch(queue);
    const second = takeConnectorEventBatch(queue);

    expect(first).toHaveLength(HOST_CONNECTOR_EVENT_BATCH_LIMIT);
    expect(second).toEqual([event(HOST_CONNECTOR_EVENT_BATCH_LIMIT)]);
    expect(queue).toEqual([]);
  });

  it("restores a failed batch ahead of events that arrived while sending", () => {
    const queue = [event(0), event(1), event(2)];
    const batch = takeConnectorEventBatch(queue);
    queue.push(event(3), event(4));

    restoreConnectorEventBatch(queue, batch);

    expect(queue).toEqual([
      event(0),
      event(1),
      event(2),
      event(3),
      event(4),
    ]);
  });
});
