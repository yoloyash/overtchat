import {
  HOST_CONNECTOR_EVENT_BATCH_BYTES,
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  type HostConnectorEvent,
} from "@overtchat/agent-bridge";

/** Reserve space for the batch envelope and sequence digits. Never skip an event. */
export function boundedEventBatch(
  events: readonly HostConnectorEvent[],
): HostConnectorEvent[] {
  const batch: HostConnectorEvent[] = [];
  let bytes = 4096;
  for (const event of events) {
    const size = Buffer.byteLength(JSON.stringify(event)) + 1;
    if (
      batch.length &&
      (bytes + size > HOST_CONNECTOR_EVENT_BATCH_BYTES ||
        batch.length >= HOST_CONNECTOR_EVENT_BATCH_LIMIT)
    )
      break;
    batch.push(event);
    bytes += size;
    // A single oversized event is delivered using fragments by the client.
    if (bytes > HOST_CONNECTOR_EVENT_BATCH_BYTES) break;
  }
  return batch;
}
