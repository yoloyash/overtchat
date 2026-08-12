import {
  applyAgentRuntimeEnvelope,
  type AgentRuntimeCursor,
  type AgentRuntimeEnvelope,
  type AgentRuntimeSnapshot,
  type AgentSessionSync,
} from "@overtchat/agent-bridge";

export type AgentSessionReplica = {
  snapshot: AgentRuntimeSnapshot;
  cursor: AgentRuntimeCursor | null;
};

export type AgentSessionOpenResult = {
  snapshot: AgentRuntimeSnapshot;
  sync?: AgentSessionSync;
};

export type AgentSessionReplicaUpdate =
  | { type: "applied"; replica: AgentSessionReplica }
  | { type: "duplicate"; replica: AgentSessionReplica }
  | { type: "reconcile"; replica: AgentSessionReplica };

export function formatAgentRuntimeCursor(cursor: AgentRuntimeCursor): string {
  return `${cursor.epoch}:${cursor.sequence}`;
}

export function parseAgentRuntimeCursor(
  value: string | null,
): AgentRuntimeCursor | undefined {
  if (!value) return undefined;
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return undefined;
  const epoch = value.slice(0, separator);
  const sequence = Number(value.slice(separator + 1));
  return Number.isSafeInteger(sequence) && sequence >= 0
    ? { epoch, sequence }
    : undefined;
}

function applyEnvelope(
  snapshot: AgentRuntimeSnapshot | undefined,
  envelope: AgentRuntimeEnvelope,
): AgentRuntimeSnapshot | null {
  const next = applyAgentRuntimeEnvelope(snapshot, envelope);
  return next && next.sessionId === snapshot?.sessionId ? next : null;
}

export function replicaFromOpenResult(
  result: AgentSessionOpenResult,
  current?: AgentSessionReplica,
): AgentSessionReplica {
  const sync = result.sync;
  if (!sync) {
    return {
      snapshot: result.snapshot,
      // A legacy snapshot has no version. Drop the old cursor so the next
      // legacy SSE snapshot can establish the runtime's current epoch instead
      // of looping forever after a runtime restart.
      cursor: null,
    };
  }
  if (sync.reset && sync.snapshot.sessionId !== result.snapshot.sessionId) {
    throw new Error("The authoritative sync belongs to a different session.");
  }
  const replica = applySyncToReplica(current, sync);
  if (!replica) {
    throw new Error("Unable to apply the authoritative session sync.");
  }
  return replica;
}

export function applySyncToReplica(
  current: AgentSessionReplica | undefined,
  sync: AgentSessionSync,
): AgentSessionReplica | null {
  if (sync.reset) {
    if (current && current.snapshot.sessionId !== sync.snapshot.sessionId) {
      return null;
    }
    return { snapshot: sync.snapshot, cursor: sync.cursor };
  }
  if (
    !current?.cursor ||
    current.cursor.epoch !== sync.cursor.epoch ||
    current.cursor.sequence > sync.cursor.sequence
  ) {
    return null;
  }

  let replica = current;
  for (const envelope of sync.events) {
    const update = applyEnvelopeToReplica(replica, envelope);
    if (update.type === "reconcile") return null;
    replica = update.replica;
  }
  return replica.cursor?.epoch === sync.cursor.epoch &&
    replica.cursor.sequence === sync.cursor.sequence
    ? replica
    : null;
}

export function resolveAgentSessionFetchRace(
  baseline: AgentSessionReplica | undefined,
  live: AgentSessionReplica | null,
  fetched: AgentSessionReplica,
): AgentSessionReplica {
  if (!live || live === baseline) return fetched;
  if (!baseline) {
    if (!fetched.cursor) return live.cursor ? live : fetched;
    if (!live.cursor || live.cursor.epoch !== fetched.cursor.epoch) return fetched;
    return live.cursor.sequence >= fetched.cursor.sequence ? live : fetched;
  }
  if (!fetched.cursor) return live;
  if (!live.cursor) return fetched;
  if (live.cursor.epoch !== fetched.cursor.epoch) {
    // A live epoch observed after this fetch began is newer than a response
    // that still belongs to the baseline epoch. If the live stream stayed on
    // the baseline, the authoritative read is the epoch-change boundary.
    return live.cursor.epoch !== baseline.cursor?.epoch ? live : fetched;
  }
  return live.cursor.sequence >= fetched.cursor.sequence ? live : fetched;
}

export function applyLegacyEnvelopeToReplica(
  replica: AgentSessionReplica,
  envelope: AgentRuntimeEnvelope,
): AgentSessionReplicaUpdate {
  const cursor = replica.cursor;
  if (
    cursor?.epoch === envelope.epoch &&
    envelope.sequence <= cursor.sequence
  ) {
    return { type: "duplicate", replica };
  }

  // Connector v0.2 minted a private snapshot sequence for every subscriber.
  // A snapshot therefore establishes a fresh boundary, while a forward gap
  // in the same epoch can only be another subscriber's private snapshot.
  if (envelope.type === "snapshot") {
    const snapshot = applyEnvelope(replica.snapshot, envelope);
    return snapshot
      ? {
          type: "applied",
          replica: {
            snapshot,
            cursor: { epoch: envelope.epoch, sequence: envelope.sequence },
          },
        }
      : { type: "reconcile", replica };
  }
  if (!cursor || envelope.epoch !== cursor.epoch) {
    return { type: "reconcile", replica };
  }

  const snapshot = applyEnvelope(replica.snapshot, envelope);
  return snapshot
    ? {
        type: "applied",
        replica: {
          snapshot,
          cursor: { epoch: envelope.epoch, sequence: envelope.sequence },
        },
      }
    : { type: "reconcile", replica };
}

export function applyEnvelopeToReplica(
  replica: AgentSessionReplica,
  envelope: AgentRuntimeEnvelope,
): AgentSessionReplicaUpdate {
  const cursor = replica.cursor;

  // Legacy connectors do not return an initial cursor. Their first snapshot
  // establishes one; accepting an initial delta would apply it to an
  // unversioned snapshot that may already be newer or older than the delta.
  if (!cursor) {
    if (envelope.type !== "snapshot") {
      return { type: "reconcile", replica };
    }
    const snapshot = applyEnvelope(replica.snapshot, envelope);
    return snapshot
      ? {
          type: "applied",
          replica: {
            snapshot,
            cursor: { epoch: envelope.epoch, sequence: envelope.sequence },
          },
        }
      : { type: "reconcile", replica };
  }

  if (envelope.epoch !== cursor.epoch) {
    return { type: "reconcile", replica };
  }
  if (envelope.sequence <= cursor.sequence) {
    return { type: "duplicate", replica };
  }
  if (envelope.sequence !== cursor.sequence + 1) {
    return { type: "reconcile", replica };
  }

  const snapshot = applyEnvelope(replica.snapshot, envelope);
  return snapshot
    ? {
        type: "applied",
        replica: {
          snapshot,
          cursor: { epoch: envelope.epoch, sequence: envelope.sequence },
        },
      }
    : { type: "reconcile", replica };
}
