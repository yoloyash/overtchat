import { createHash } from "node:crypto";
import {
  HOST_CONNECTOR_FRAGMENT_BYTES,
  HOST_CONNECTOR_MAX_EVENT_BYTES,
  isHostConnectorEvent,
  type HostConnectorEvent,
  type HostConnectorEventAck,
  type HostConnectorEventFragment,
} from "@overtchat/agent-bridge";

type Assembly = {
  digest: string;
  totalBytes: number;
  chunks: Buffer[];
  updatedAt: number;
};

/** Process-local partial transfers may be discarded: no event is acked before commit. */
export class ConnectorEventFragments {
  private readonly assemblies = new Map<string, Assembly>();
  constructor(private readonly now = Date.now) {}

  async accept(
    connectorId: string,
    epoch: string,
    fragment: HostConnectorEventFragment,
    commit: (event: HostConnectorEvent) => Promise<HostConnectorEventAck>,
  ): Promise<HostConnectorEventAck> {
    const key = `${connectorId}:${epoch}:${fragment.sequence}`;
    for (const [id, value] of this.assemblies) {
      if (this.now() - value.updatedAt > 60_000) this.assemblies.delete(id);
    }
    let assembly = this.assemblies.get(key);
    if (
      fragment.index === 0 &&
      (!assembly || assembly.digest !== fragment.digest)
    ) {
      // At most one in-flight event per connector; bound abandoned transfers.
      for (const id of this.assemblies.keys())
        if (id.startsWith(`${connectorId}:`)) this.assemblies.delete(id);
      const reserved = [...this.assemblies.values()].reduce(
        (bytes, value) => bytes + value.totalBytes,
        0,
      );
      if (reserved + fragment.totalBytes > HOST_CONNECTOR_MAX_EVENT_BYTES)
        throw new Error(
          "Partial connector transfers exceed the memory budget.",
        );
      if (this.assemblies.size >= 8)
        throw new Error("Too many partial connector transfers.");
      assembly = {
        digest: fragment.digest,
        totalBytes: fragment.totalBytes,
        chunks: [],
        updatedAt: this.now(),
      };
      this.assemblies.set(key, assembly);
    }
    const partial = (nextFragmentIndex: number): HostConnectorEventAck => ({
      connectorEpoch: epoch,
      acknowledgedSequence: fragment.sequence - 1,
      nextFragmentIndex,
    });
    if (!assembly) return partial(0);
    if (
      assembly.digest !== fragment.digest ||
      assembly.totalBytes !== fragment.totalBytes
    )
      throw new Error("Connector fragment identity changed.");
    if (fragment.index > assembly.chunks.length)
      return partial(assembly.chunks.length);
    const chunk = Buffer.from(fragment.data, "base64");
    const expected = Math.min(
      HOST_CONNECTOR_FRAGMENT_BYTES,
      fragment.totalBytes - fragment.index * HOST_CONNECTOR_FRAGMENT_BYTES,
    );
    if (chunk.length !== expected)
      throw new Error("Invalid connector fragment length.");
    if (
      fragment.index < assembly.chunks.length &&
      !chunk.equals(assembly.chunks[fragment.index]!)
    )
      throw new Error("Connector fragment contents changed.");
    if (fragment.index === assembly.chunks.length) assembly.chunks.push(chunk);
    assembly.updatedAt = this.now();
    const count = Math.ceil(
      fragment.totalBytes / HOST_CONNECTOR_FRAGMENT_BYTES,
    );
    if (assembly.chunks.length < count) return partial(assembly.chunks.length);
    const bytes = Buffer.concat(assembly.chunks);
    if (createHash("sha256").update(bytes).digest("hex") !== fragment.digest)
      throw new Error("Connector event digest mismatch.");
    const event: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isHostConnectorEvent(event) || event.sequence !== fragment.sequence)
      throw new Error("Invalid reassembled connector event.");
    const ack = await commit(event);
    this.assemblies.delete(key);
    return { ...ack, nextFragmentIndex: count };
  }
}

export const connectorEventFragments = new ConnectorEventFragments();
