import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  type HostConnectorEvent,
} from "@overtchat/agent-bridge";

export function takeConnectorEventBatch(
  queue: HostConnectorEvent[],
): HostConnectorEvent[] {
  return queue.splice(0, HOST_CONNECTOR_EVENT_BATCH_LIMIT);
}

export function restoreConnectorEventBatch(
  queue: HostConnectorEvent[],
  batch: HostConnectorEvent[],
): void {
  queue.unshift(...batch);
}
