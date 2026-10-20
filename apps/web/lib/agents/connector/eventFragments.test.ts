import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_FRAGMENT_BYTES,
  type HostConnectorEvent,
  type HostConnectorEventFragment,
} from "@overtchat/agent-bridge";
import { ConnectorEventFragments } from "./eventFragments";

function fragments(event: HostConnectorEvent): HostConnectorEventFragment[] {
  const bytes = Buffer.from(JSON.stringify(event));
  const digest = createHash("sha256").update(bytes).digest("hex");
  return Array.from(
    { length: Math.ceil(bytes.length / HOST_CONNECTOR_FRAGMENT_BYTES) },
    (_, index) => ({
      sequence: event.sequence,
      digest,
      index,
      totalBytes: bytes.length,
      data: bytes
        .subarray(
          index * HOST_CONNECTOR_FRAGMENT_BYTES,
          (index + 1) * HOST_CONNECTOR_FRAGMENT_BYTES,
        )
        .toString("base64"),
    }),
  );
}
const event: HostConnectorEvent = {
  sequence: 40,
  payload: {
    type: "response",
    requestId: "large",
    success: true,
    data: "😀\n".repeat(2_000_000),
  },
};

describe("connector fragment reassembly", () => {
  it("preserves a >10MiB Unicode event, retries partial fragments, and acknowledges only after commit", async () => {
    const receiver = new ConnectorEventFragments();
    const parts = fragments(event);
    const commit = vi.fn(async (received: HostConnectorEvent) => ({
      connectorEpoch: "epoch",
      acknowledgedSequence: received.sequence,
    }));
    const first = await receiver.accept(
      "connector",
      "epoch",
      parts[0]!,
      commit,
    );
    expect(first).toMatchObject({
      acknowledgedSequence: 39,
      nextFragmentIndex: 1,
    });
    expect(commit).not.toHaveBeenCalled();
    expect(
      await receiver.accept("connector", "epoch", parts[0]!, commit),
    ).toEqual(first);
    for (const part of parts.slice(1))
      await receiver.accept("connector", "epoch", part, commit);
    expect(commit).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("requests restart after losing partial state and isolates connectors", async () => {
    const receiver = new ConnectorEventFragments();
    const parts = fragments(event);
    const commit = vi.fn(async () => ({
      connectorEpoch: "epoch",
      acknowledgedSequence: 40,
    }));
    await receiver.accept("one", "epoch", parts[0]!, commit);
    expect(
      await receiver.accept("two", "epoch", parts[1]!, commit),
    ).toMatchObject({ acknowledgedSequence: 39, nextFragmentIndex: 0 });
    const restarted = new ConnectorEventFragments();
    expect(
      await restarted.accept("one", "epoch", parts[1]!, commit),
    ).toMatchObject({ acknowledgedSequence: 39, nextFragmentIndex: 0 });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects changed contents, invalid lengths, and expired partial transfers", async () => {
    let now = 0;
    const receiver = new ConnectorEventFragments(() => now);
    const parts = fragments(event);
    const commit = vi.fn();
    await receiver.accept("one", "epoch", parts[0]!, commit);
    await expect(
      receiver.accept(
        "one",
        "epoch",
        {
          ...parts[0]!,
          data: Buffer.alloc(HOST_CONNECTOR_FRAGMENT_BYTES, 65).toString(
            "base64",
          ),
        },
        commit,
      ),
    ).rejects.toThrow("contents changed");
    await expect(
      receiver.accept("one", "epoch", { ...parts[1]!, data: "YQ==" }, commit),
    ).rejects.toThrow("length");
    now = 60_001;
    expect(
      await receiver.accept("one", "epoch", parts[1]!, commit),
    ).toMatchObject({ nextFragmentIndex: 0 });
  });
  it("retains the assembled event when commit fails and retries its final fragment", async () => {
    const receiver = new ConnectorEventFragments();
    const small = fragments({ sequence: 1, payload: { type: "response", requestId: "one", success: true, data: "done" } })[0]!;
    const commit = vi.fn().mockRejectedValueOnce(new Error("commit failed")).mockResolvedValueOnce({ connectorEpoch: "epoch", acknowledgedSequence: 1 });
    await expect(receiver.accept("one", "epoch", small, commit)).rejects.toThrow("commit failed");
    expect(await receiver.accept("one", "epoch", small, commit)).toMatchObject({ acknowledgedSequence: 1, nextFragmentIndex: 1 });
  });

  it("bounds memory reserved by concurrent partial events and releases expired reservations", async () => {
    let now = 0;
    const receiver = new ConnectorEventFragments(() => now);
    const first = { ...fragments(event)[0]!, totalBytes: 127 * 1024 * 1024 };
    const second = { ...first, totalBytes: 2 * 1024 * 1024 };
    const commit = vi.fn();
    await receiver.accept("one", "epoch", first, commit);
    await expect(receiver.accept("two", "epoch", second, commit)).rejects.toThrow("memory budget");
    now = 60_001;
    expect(await receiver.accept("two", "epoch", second, commit)).toMatchObject({ nextFragmentIndex: 1 });
  });

});
