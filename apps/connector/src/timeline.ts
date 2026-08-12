import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import {
  applyAgentRuntimeEnvelope,
  isAgentRuntimeEnvelope,
  type AgentRuntimeCursor,
  type AgentRuntimeEnvelope,
  type AgentRuntimeSnapshot,
  type AgentSessionSync,
  reconcileAgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";

const FORMAT = 1;
const COMMIT_DELAY_MS = 25;
const MAX_TAIL_EVENTS = 500;
const MAX_TAIL_BYTES = 8 * 1024 * 1024;

type CheckpointRecord = {
  format: 1;
  type: "checkpoint";
  sessionId: string;
  providerSessionId: string;
  epoch: string;
  sequence: number;
  snapshot: AgentRuntimeSnapshot;
};

type EventRecord = {
  format: 1;
  type: "event";
  envelope: AgentRuntimeEnvelope;
};

type TimelineState = {
  sessionId: string;
  providerSessionId: string;
  file: string;
  epoch: string;
  sequence: number;
  snapshot: AgentRuntimeSnapshot;
  events: AgentRuntimeEnvelope[];
  tailBytes: number;
  subscribers: Set<(envelope: AgentRuntimeEnvelope) => void>;
};

type PendingCommit = {
  envelope: AgentRuntimeEnvelope;
  resolve: (envelope: AgentRuntimeEnvelope | null) => void;
  reject: (error: Error) => void;
};

type PendingBatch = {
  commits: PendingCommit[];
  timer: NodeJS.Timeout;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function timelineFilename(sessionId: string): string {
  return `${createHash("sha256").update(sessionId).digest("hex")}.jsonl`;
}

function serializeRecord(record: CheckpointRecord | EventRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function checkpointRecord(state: TimelineState): CheckpointRecord {
  return {
    format: FORMAT,
    type: "checkpoint",
    sessionId: state.sessionId,
    providerSessionId: state.providerSessionId,
    epoch: state.epoch,
    sequence: state.sequence,
    snapshot: state.snapshot,
  };
}

function isSnapshot(value: unknown): value is AgentRuntimeSnapshot {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    ["idle", "running", "exited"].includes(String(value.status))
  );
}

function parseCheckpoint(value: unknown): CheckpointRecord {
  if (
    !isRecord(value) ||
    value.format !== FORMAT ||
    value.type !== "checkpoint" ||
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.providerSessionId !== "string" ||
    !value.providerSessionId ||
    typeof value.epoch !== "string" ||
    !value.epoch ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 0 ||
    !isSnapshot(value.snapshot) ||
    value.snapshot.sessionId !== value.sessionId
  ) {
    throw new Error("Invalid Host Connector timeline checkpoint.");
  }
  return value as CheckpointRecord;
}

function coalesceCommits(commits: PendingCommit[]): PendingCommit[][] {
  const groups: PendingCommit[][] = [];
  for (const commit of commits) {
    const previous = groups.at(-1);
    const previousEnvelope = previous?.at(-1)?.envelope;
    const current = commit.envelope;
    const replaceableSnapshot =
      current.type === "snapshot" && previousEnvelope?.type === "snapshot";
    const replaceableTurn =
      current.type === "runtime_event" &&
      previousEnvelope?.type === "runtime_event" &&
      current.data.type === "overtchat_turn_update" &&
      previousEnvelope.data.type === "overtchat_turn_update" &&
      current.data.turnId === previousEnvelope.data.turnId;
    if (previous && (replaceableSnapshot || replaceableTurn)) {
      previous.push(commit);
    } else {
      groups.push([commit]);
    }
  }
  return groups;
}

function canonicalizeCommit(
  envelope: AgentRuntimeEnvelope,
): AgentRuntimeEnvelope {
  if (envelope.type === "snapshot") return envelope;
  const recordedAt = envelope.data.overtchatRecordedAt;
  return {
    ...envelope,
    data: {
      ...envelope.data,
      // Reducer-created fields must be replayable byte-for-byte. Capture the
      // connector's wall clock once, before events can be coalesced, instead
      // of consulting it again while rebuilding the journal.
      overtchatRecordedAt:
        typeof recordedAt === "number" && Number.isFinite(recordedAt)
          ? recordedAt
          : Date.now(),
    },
  };
}

export class ConnectorTimelineStore {
  private readonly states = new Map<string, TimelineState>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, PendingBatch>();
  private readonly deleted = new Set<string>();
  private fatal: Error | null = null;
  private closed = false;

  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<ConnectorTimelineStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    return new ConnectorTimelineStore(directory);
  }

  async openSession(
    sessionId: string,
    providerSessionId: string,
    snapshot: AgentRuntimeSnapshot,
  ): Promise<AgentRuntimeCursor> {
    this.assertOpen();
    if (snapshot.sessionId !== sessionId) {
      throw new Error("The timeline snapshot belongs to a different session.");
    }
    await this.flushPending(sessionId);
    this.assertOpen();
    return this.enqueue(sessionId, async () => {
      this.deleted.delete(sessionId);
      let state = await this.load(sessionId);
      if (!state) {
        state = {
          sessionId,
          providerSessionId,
          file: this.fileFor(sessionId),
          epoch: crypto.randomUUID(),
          sequence: 0,
          snapshot,
          events: [],
          tailBytes: 0,
          subscribers: new Set(),
        };
        await this.writeCheckpoint(state);
        this.assertHealthy();
        this.states.set(sessionId, state);
        return { epoch: state.epoch, sequence: state.sequence };
      }

      if (state.providerSessionId !== providerSessionId) {
        const envelope: AgentRuntimeEnvelope = {
          epoch: crypto.randomUUID(),
          sequence: 1,
          type: "snapshot",
          data: snapshot,
        };
        const replacement: TimelineState = {
          sessionId,
          providerSessionId,
          file: state.file,
          epoch: envelope.epoch,
          sequence: envelope.sequence,
          snapshot,
          events: [],
          tailBytes: 0,
          // Keep the same Set instance so existing unsubscribe closures remain
          // valid while the committed reset wakes every active subscriber.
          subscribers: state.subscribers,
        };
        await this.writeCheckpoint(replacement);
        this.assertHealthy();
        this.states.set(sessionId, replacement);
        this.notify(replacement, [envelope]);
        return {
          epoch: replacement.epoch,
          sequence: replacement.sequence,
        };
      }

      const reconciled = reconcileAgentRuntimeSnapshot(state.snapshot, snapshot);
      const envelope: AgentRuntimeEnvelope = {
        epoch: state.epoch,
        sequence: state.sequence + 1,
        type: "snapshot",
        data: reconciled,
      };
      const checkpoint: TimelineState = {
        ...state,
        sequence: envelope.sequence,
        snapshot: reconciled,
        events: [],
        tailBytes: 0,
      };
      await this.writeCheckpoint(checkpoint);
      this.assertHealthy();
      state.sequence = checkpoint.sequence;
      state.snapshot = checkpoint.snapshot;
      state.events = checkpoint.events;
      state.tailBytes = checkpoint.tailBytes;
      this.notify(state, [envelope]);
      return { epoch: state.epoch, sequence: state.sequence };
    });
  }

  commit(
    sessionId: string,
    envelope: AgentRuntimeEnvelope,
  ): Promise<AgentRuntimeEnvelope | null> {
    this.assertOpen();
    if (this.deleted.has(sessionId)) {
      return Promise.reject(new Error("The session timeline has been deleted."));
    }
    const canonicalEnvelope = canonicalizeCommit(envelope);
    return new Promise((resolve, reject) => {
      const current = this.pending.get(sessionId);
      if (current) {
        current.commits.push({ envelope: canonicalEnvelope, resolve, reject });
        return;
      }
      const commits = [{ envelope: canonicalEnvelope, resolve, reject }];
      const timer = setTimeout(() => {
        void this.drainPending(sessionId).catch(() => {});
      }, COMMIT_DELAY_MS);
      timer.unref();
      this.pending.set(sessionId, { commits, timer });
    });
  }

  async sync(
    sessionId: string,
    after?: AgentRuntimeCursor,
  ): Promise<AgentSessionSync> {
    this.assertOpen();
    await this.flushPending(sessionId);
    this.assertOpen();
    return this.enqueue(sessionId, async () => {
      const state = await this.requireState(sessionId);
      this.assertHealthy();
      return this.syncState(state, after);
    });
  }

  async subscribe(
    sessionId: string,
    after: AgentRuntimeCursor | undefined,
    subscriber: (envelope: AgentRuntimeEnvelope) => void,
  ): Promise<{ sync: AgentSessionSync; unsubscribe: () => void }> {
    this.assertOpen();
    await this.flushPending(sessionId);
    this.assertOpen();
    return this.enqueue(sessionId, async () => {
      const state = await this.requireState(sessionId);
      this.assertHealthy();
      state.subscribers.add(subscriber);
      return {
        sync: this.syncState(state, after),
        unsubscribe: () => state.subscribers.delete(subscriber),
      };
    });
  }

  async flush(sessionId: string): Promise<void> {
    this.assertOpen();
    await this.flushPending(sessionId);
    await (this.tails.get(sessionId) ?? Promise.resolve());
    this.assertOpen();
  }

  async releaseSession(sessionId: string): Promise<void> {
    this.assertOpen();
    await this.flushPending(sessionId);
    this.assertOpen();
    await this.enqueue(sessionId, async () => {
      const state = this.states.get(sessionId);
      if (!state || state.subscribers.size > 0) return;
      this.states.delete(sessionId);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.assertOpen();
    this.deleted.add(sessionId);
    await this.flushPending(sessionId);
    this.assertOpen();
    await this.enqueue(sessionId, async () => {
      const state = this.states.get(sessionId);
      await this.removeTimeline(this.fileFor(sessionId));
      this.assertHealthy();
      state?.subscribers.clear();
      this.states.delete(sessionId);
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      if (this.fatal) throw this.fatal;
      return;
    }
    this.closed = true;
    await Promise.allSettled(
      [...this.pending.keys()].map((sessionId) =>
        this.flushPending(sessionId),
      ),
    );
    await Promise.allSettled(this.tails.values());
    this.states.clear();
    if (this.fatal) throw this.fatal;
  }

  private async drainPending(sessionId: string): Promise<void> {
    const batch = this.pending.get(sessionId);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.pending.delete(sessionId);
    try {
      const results = await this.enqueue(sessionId, async () => {
        const state = await this.requireState(sessionId);
        const groups = coalesceCommits(batch.commits);
        const canonical: AgentRuntimeEnvelope[] = [];
        let snapshot = state.snapshot;
        let sequence = state.sequence;
        for (const group of groups) {
          const source = group.at(-1)!.envelope;
          const envelope = {
            epoch: state.epoch,
            sequence: ++sequence,
            type: source.type,
            data:
              source.type === "snapshot"
                ? reconcileAgentRuntimeSnapshot(snapshot, source.data)
                : source.data,
          } as AgentRuntimeEnvelope;
          const nextSnapshot = applyAgentRuntimeEnvelope(snapshot, envelope);
          if (!nextSnapshot) {
            throw new Error("Unable to apply a Host Connector timeline event.");
          }
          snapshot = nextSnapshot;
          canonical.push(envelope);
        }

        const serialized = canonical.map((envelope) =>
          serializeRecord({ format: FORMAT, type: "event", envelope }),
        );
        const addedBytes = serialized.reduce(
          (total, line) => total + Buffer.byteLength(line),
          0,
        );
        const checkpoint =
          canonical.some((envelope) => envelope.type === "snapshot") ||
          state.events.length + canonical.length > MAX_TAIL_EVENTS ||
          state.tailBytes + addedBytes > MAX_TAIL_BYTES;
        const next: TimelineState = {
          ...state,
          sequence,
          snapshot,
          events: checkpoint ? [] : [...state.events, ...canonical],
          tailBytes: checkpoint ? 0 : state.tailBytes + addedBytes,
        };
        if (checkpoint) {
          await this.writeCheckpoint(next);
        } else {
          await this.append(next.file, serialized.join(""));
        }
        this.assertHealthy();
        state.sequence = next.sequence;
        state.snapshot = next.snapshot;
        state.events = next.events;
        state.tailBytes = next.tailBytes;
        this.notify(state, canonical);
        return { groups, canonical };
      });

      results.groups.forEach((group, index) => {
        const delivered = results.canonical[index]!;
        group.forEach((commit, groupIndex) =>
          commit.resolve(groupIndex === group.length - 1 ? delivered : null),
        );
      });
    } catch (error) {
      const failure = errorValue(error);
      for (const commit of batch.commits) commit.reject(failure);
      throw failure;
    }
  }

  private flushPending(sessionId: string): Promise<void> {
    if (!this.pending.has(sessionId)) return Promise.resolve();
    return this.drainPending(sessionId);
  }

  private syncState(
    state: TimelineState,
    after?: AgentRuntimeCursor,
  ): AgentSessionSync {
    const cursor = { epoch: state.epoch, sequence: state.sequence };
    const reset = (): AgentSessionSync => ({
      reset: true,
      cursor,
      snapshot: state.snapshot,
    });
    if (
      !after ||
      after.epoch !== state.epoch ||
      after.sequence > state.sequence
    ) {
      return reset();
    }
    if (after.sequence === state.sequence) {
      return { reset: false, cursor, events: [] };
    }
    const first = state.events[0]?.sequence;
    if (first === undefined || after.sequence < first - 1) return reset();
    const events = state.events.filter(
      (envelope) => envelope.sequence > after.sequence,
    );
    if (
      events[0]?.sequence !== after.sequence + 1 ||
      events.at(-1)?.sequence !== state.sequence
    ) {
      return reset();
    }
    return { reset: false, cursor, events };
  }

  private async load(sessionId: string): Promise<TimelineState | null> {
    const cached = this.states.get(sessionId);
    if (cached) return cached;
    const file = this.fileFor(sessionId);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw this.failPersistence(error);
    }
    try {
      const unterminatedFinalRecord = !raw.endsWith("\n");
      const sourceLines = raw.split("\n");
      if (!unterminatedFinalRecord) sourceLines.pop();
      if (sourceLines.length === 0) {
        throw new Error("Empty Host Connector timeline journal.");
      }
      let checkpoint: CheckpointRecord;
      try {
        checkpoint = parseCheckpoint(JSON.parse(sourceLines[0]!));
      } catch (error) {
        throw new Error("Unable to read Host Connector timeline checkpoint.", {
          cause: error,
        });
      }
      if (checkpoint.sessionId !== sessionId) {
        throw new Error("Host Connector timeline session identity mismatch.");
      }
      let snapshot = checkpoint.snapshot;
      let sequence = checkpoint.sequence;
      const events: AgentRuntimeEnvelope[] = [];
      let tailBytes = 0;
      const repair = unterminatedFinalRecord;
      for (let index = 1; index < sourceLines.length; index += 1) {
        const line = sourceLines[index]!;
        const recoverableFinalRecord =
          unterminatedFinalRecord && index === sourceLines.length - 1;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (error) {
          if (recoverableFinalRecord) break;
          throw new Error("Corrupt Host Connector timeline journal.", {
            cause: error,
          });
        }
        if (
          !isRecord(parsed) ||
          parsed.format !== FORMAT ||
          parsed.type !== "event" ||
          !isAgentRuntimeEnvelope(parsed.envelope) ||
          parsed.envelope.epoch !== checkpoint.epoch ||
          parsed.envelope.sequence !== sequence + 1
        ) {
          if (recoverableFinalRecord) break;
          throw new Error("Invalid Host Connector timeline event journal.");
        }
        const next = applyAgentRuntimeEnvelope(snapshot, parsed.envelope);
        if (!next) {
          if (recoverableFinalRecord) break;
          throw new Error("Invalid Host Connector timeline state.");
        }
        snapshot = next;
        sequence = parsed.envelope.sequence;
        events.push(parsed.envelope);
        tailBytes += Buffer.byteLength(`${line}\n`);
      }
      const state: TimelineState = {
        sessionId,
        providerSessionId: checkpoint.providerSessionId,
        file,
        epoch: checkpoint.epoch,
        sequence,
        snapshot,
        events,
        tailBytes,
        subscribers: new Set(),
      };
      if (repair) {
        await this.writeCheckpoint(state);
        this.assertHealthy();
        state.events = [];
        state.tailBytes = 0;
      }
      this.states.set(sessionId, state);
      return state;
    } catch (error) {
      throw this.failPersistence(error);
    }
  }

  private async requireState(sessionId: string): Promise<TimelineState> {
    const state = await this.load(sessionId);
    if (!state) throw new Error("The session timeline is not initialized.");
    return state;
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(() => {
      this.assertHealthy();
      return operation();
    });
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId);
    });
    return result;
  }

  private async append(file: string, value: string): Promise<void> {
    try {
      const handle = await open(
        file,
        fsConstants.O_WRONLY | fsConstants.O_APPEND,
      );
      try {
        await handle.writeFile(value, "utf8");
        await handle.chmod(0o600);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw this.failPersistence(error);
    }
  }

  private async writeCheckpoint(state: TimelineState): Promise<void> {
    let temporary: string | undefined;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      temporary = `${state.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(
          serializeRecord(checkpointRecord(state)),
          "utf8",
        );
        await handle.chmod(0o600);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, state.file);
      temporary = undefined;
      await this.syncDirectory();
    } catch (error) {
      let failure = errorValue(error);
      if (temporary) {
        try {
          await rm(temporary, { force: true });
        } catch (cleanupError) {
          failure = new AggregateError(
            [failure, errorValue(cleanupError)],
            "Timeline checkpoint and temporary-file cleanup both failed.",
          );
        }
      }
      throw this.failPersistence(failure);
    }
  }

  private async removeTimeline(file: string): Promise<void> {
    try {
      await rm(file, { force: true });
      await this.syncDirectory();
    } catch (error) {
      throw this.failPersistence(error);
    }
  }

  private async syncDirectory(): Promise<void> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(this.directory, "r");
      await handle.sync();
    } catch (error) {
      if (
        ["EINVAL", "ENOTSUP", "EISDIR", "EPERM"].includes(
          String((error as NodeJS.ErrnoException).code),
        )
      ) {
        return;
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private notify(
    state: TimelineState,
    envelopes: AgentRuntimeEnvelope[],
  ): void {
    for (const envelope of envelopes) {
      for (const subscriber of state.subscribers) {
        try {
          subscriber(envelope);
        } catch (error) {
          console.error("Host Connector timeline subscriber failed.", error);
        }
      }
    }
  }

  private failPersistence(error: unknown): Error {
    if (this.fatal) return this.fatal;
    const cause = errorValue(error);
    const failure = new Error(
      `Host Connector timeline persistence failed: ${cause.message}`,
      { cause },
    );
    this.fatal = failure;
    for (const [sessionId, batch] of this.pending) {
      clearTimeout(batch.timer);
      this.pending.delete(sessionId);
      for (const commit of batch.commits) commit.reject(failure);
    }
    return failure;
  }

  private fileFor(sessionId: string): string {
    return path.join(this.directory, timelineFilename(sessionId));
  }

  private assertOpen(): void {
    this.assertHealthy();
    if (this.closed) throw new Error("The Host Connector timeline store is closed.");
  }

  private assertHealthy(): void {
    if (this.fatal) throw this.fatal;
  }
}
