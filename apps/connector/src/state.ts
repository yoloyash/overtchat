import {
  HOST_CONNECTOR_EVENT_BATCH_BYTES,
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  type AgentDaemonSessionDescriptor,
  type AgentQueuedMessage,
  type HostConnectorEvent,
  type HostConnectorEventAck,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import { ConnectorInstanceLock } from "./lock.js";
import { cleanJournalArtifacts, initializeJournalFile } from "./state-import.js";
import {
  isCommandEntry, isCommandIdentity, isSessionState, stableCommandResult,
  type BeginCommandResult, type CachedCommandResult, type CommandJournalEntry, type SessionState,
} from "./state-format.js";
import { configureJournalDatabase, openJournalDatabase, transaction, type JournalDatabase } from "./journal-sqlite.js";

export type { BeginCommandResult, CachedCommandResult, CommandJournalEntry } from "./state-format.js";

type Metadata = { epoch: string; next: number; acknowledged: number };

export class ConnectorStateJournal {
  private lifecycle: "open" | "closing" | "closed" = "open";
  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly db: JournalDatabase,
    private readonly lock: ConnectorInstanceLock,
  ) {}

  static async open(file: string): Promise<ConnectorStateJournal> {
    // The client also holds the pairing lock. A journal lock makes direct
    // preflight/test/backup users obey the same single-writer cleanup rule.
    const lock = await ConnectorInstanceLock.acquire(`${file}.lock`);
    let db: JournalDatabase | undefined;
    try {
      await cleanJournalArtifacts(file);
      await initializeJournalFile(file);
      db = await openJournalDatabase(file);
      if (db.prepare("PRAGMA user_version").get()?.user_version !== 4) {
        throw new Error("Unsupported Host Connector journal schema.");
      }
      configureJournalDatabase(db);
      const journal = new ConnectorStateJournal(db, lock);
      const meta = journal.metadata();
      const bounds = db.prepare("SELECT count(*) AS count, min(sequence) AS first, max(sequence) AS last FROM events").get()!;
      if (!meta.epoch || !Number.isSafeInteger(meta.next) || !Number.isSafeInteger(meta.acknowledged) ||
          meta.acknowledged < 0 || meta.next < meta.acknowledged ||
          bounds.count !== meta.next - meta.acknowledged ||
          Number(bounds.first ?? meta.acknowledged + 1) !== meta.acknowledged + 1 ||
          Number(bounds.last ?? meta.acknowledged) !== meta.next) {
        throw new Error("Invalid Host Connector event journal.");
      }
      return journal;
    } catch (error) {
      try { db?.close(); } finally { await lock.release(); }
      throw error;
    }
  }

  private metadata(): Metadata {
    const row = this.db.prepare("SELECT * FROM metadata WHERE id = 1").get();
    if (!row) throw new Error("Invalid Host Connector state journal.");
    return { epoch: String(row.connector_epoch), next: Number(row.next_sequence), acknowledged: Number(row.acknowledged_sequence) };
  }

  get connectorEpoch(): string { return this.metadata().epoch; }

  enqueue(payload: HostConnectorEventPayload): HostConnectorEvent {
    this.assertOpen();
    // Commit before returning: no pending JSON snapshots or asynchronous write
    // queue can multiply the backlog in memory or acknowledge an uncommitted row.
    const json = JSON.stringify(payload);
    return transaction(this.db, () => {
      const sequence = this.metadata().next + 1;
      this.db.prepare("INSERT INTO events VALUES (?, ?, ?)").run(sequence, json, Buffer.byteLength(json) + 64);
      this.db.prepare("UPDATE metadata SET next_sequence = ? WHERE id = 1").run(sequence);
      return { sequence, payload };
    });
  }

  eventBatch(): HostConnectorEvent[] {
    this.assertOpen();
    // Select only small size/sequence rows first. Never materialize LIMIT 256
    // large payloads before applying the byte limit.
    const sizes = this.db.prepare("SELECT sequence, bytes FROM events ORDER BY sequence LIMIT ?").all(HOST_CONNECTOR_EVENT_BATCH_LIMIT);
    let bytes = 4096;
    let last: number | undefined;
    for (const row of sizes) {
      if (last !== undefined && bytes + Number(row.bytes) > HOST_CONNECTOR_EVENT_BATCH_BYTES) break;
      last = Number(row.sequence);
      bytes += Number(row.bytes);
      // One oversized event is sent with the existing fragmentation protocol.
      if (bytes > HOST_CONNECTOR_EVENT_BATCH_BYTES) break;
    }
    if (last === undefined) return [];
    return this.db.prepare("SELECT sequence, payload_json FROM events WHERE sequence <= ? ORDER BY sequence").all(last)
      .map((row) => ({ sequence: Number(row.sequence), payload: JSON.parse(String(row.payload_json)) as HostConnectorEventPayload }));
  }

  async acknowledge(ack: HostConnectorEventAck): Promise<"acknowledged" | "rebased"> {
    this.assertOpen();
    const result = transaction(this.db, () => {
      const meta = this.metadata();
      if (ack.connectorEpoch !== meta.epoch) throw new Error("OvertChat acknowledged a different connector epoch.");
      if (!Number.isSafeInteger(ack.acknowledgedSequence) || ack.acknowledgedSequence < 0 || ack.acknowledgedSequence > meta.next) {
        throw new Error("OvertChat returned an invalid connector acknowledgement.");
      }
      if (ack.acknowledgedSequence < meta.acknowledged) {
        // Legacy server cursor loss rotates transport identity, never commands.
        // A negative intermediate key avoids primary-key collisions without
        // loading/re-serializing the pending payloads.
        this.db.exec("UPDATE events SET sequence = -sequence");
        this.db.prepare("UPDATE events SET sequence = -sequence - ?").run(meta.acknowledged);
        this.db.prepare("UPDATE metadata SET connector_epoch = ?, next_sequence = ?, acknowledged_sequence = 0 WHERE id = 1")
          .run(crypto.randomUUID(), meta.next - meta.acknowledged);
        return "rebased" as const;
      }
      this.db.prepare("DELETE FROM events WHERE sequence <= ?").run(ack.acknowledgedSequence);
      this.db.prepare("UPDATE metadata SET acknowledged_sequence = ? WHERE id = 1").run(ack.acknowledgedSequence);
      return "acknowledged" as const;
    });
    // Bound maintenance per acknowledgement; remaining free pages are reused.
    this.db.exec("PRAGMA incremental_vacuum(1024)");
    return result;
  }

  commandEntry(commandId: string): CommandJournalEntry | undefined {
    this.assertOpen();
    const row = this.db.prepare("SELECT entry_json FROM commands WHERE command_id = ?").get(commandId);
    if (!row) return undefined;
    const entry: unknown = JSON.parse(String(row.entry_json));
    if (!isCommandEntry(entry)) throw new Error("Invalid Host Connector command journal.");
    return entry;
  }

  async beginCommand(commandId: string, sessionId: string, fingerprint: string): Promise<BeginCommandResult> {
    this.assertOpen();
    if (!isCommandIdentity(commandId, sessionId, fingerprint)) throw new Error("Invalid command ledger identity.");
    return transaction(this.db, () => {
      const existing = this.commandEntry(commandId);
      if (existing) {
        if (existing.sessionId !== null && existing.fingerprint !== null &&
            (existing.sessionId !== sessionId || existing.fingerprint !== fingerprint)) {
          throw new Error("A command identity was reused for different work.");
        }
        return existing.status === "completed" ? { status: "completed", result: existing.result } : { status: "pending" };
      }
      const entry: CommandJournalEntry = { commandId, sessionId, fingerprint, status: "pending" };
      this.db.prepare("INSERT INTO commands VALUES (?, ?, ?)").run(commandId, sessionId, JSON.stringify(entry));
      return { status: "execute" };
    });
  }

  async completeCommand(commandId: string, sessionId: string, fingerprint: string, result: CachedCommandResult): Promise<void> {
    this.assertOpen();
    if (!isCommandIdentity(commandId, sessionId, fingerprint)) throw new Error("Invalid command ledger identity.");
    transaction(this.db, () => {
      const existing = this.commandEntry(commandId);
      if (!existing || existing.sessionId !== sessionId || existing.fingerprint !== fingerprint) {
        throw new Error("The command ledger entry changed before completion.");
      }
      if (existing.status === "completed") throw new Error("The command ledger entry was already completed.");
      const entry: CommandJournalEntry = { commandId, sessionId, fingerprint, status: "completed", result: stableCommandResult(result) };
      this.db.prepare("UPDATE commands SET entry_json = ? WHERE command_id = ?").run(JSON.stringify(entry), commandId);
    });
  }

  private sessionState(sessionId: string): SessionState | undefined {
    const row = this.db.prepare("SELECT state_json FROM sessions WHERE session_id = ?").get(sessionId);
    if (!row) return undefined;
    const state: unknown = JSON.parse(String(row.state_json));
    if (!isSessionState(state, sessionId)) throw new Error("Invalid Host Connector session journal.");
    return state;
  }

  sessionQueue(sessionId: string): readonly AgentQueuedMessage[] {
    this.assertOpen();
    return this.sessionState(sessionId)?.queuedMessages ?? [];
  }

  sessionIds(): string[] {
    this.assertOpen();
    return this.db.prepare("SELECT session_id FROM sessions ORDER BY rowid").all().map((row) => String(row.session_id));
  }

  sessionIdsForWorkspace(workspaceId: string): string[] {
    this.assertOpen();
    return this.db.prepare("SELECT session_id FROM sessions WHERE workspace_id = ? ORDER BY rowid").all(workspaceId).map((row) => String(row.session_id));
  }

  sessionIdsForConnection(connectionId: string): string[] {
    this.assertOpen();
    return this.db.prepare("SELECT session_id FROM sessions WHERE connection_id = ? ORDER BY rowid").all(connectionId).map((row) => String(row.session_id));
  }

  async retainSessions(sessionIds: ReadonlySet<string>): Promise<string[]> {
    this.assertOpen();
    return transaction(this.db, () => {
      const removed = this.sessionIds().filter((id) => !sessionIds.has(id));
      for (const id of removed) this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(id);
      // Delete orphan command scopes even when no descriptor ever existed.
      const commandScopes = this.db.prepare("SELECT DISTINCT session_id FROM commands WHERE session_id IS NOT NULL").all();
      for (const row of commandScopes) {
        if (!sessionIds.has(String(row.session_id))) this.db.prepare("DELETE FROM commands WHERE session_id = ?").run(row.session_id);
      }
      return removed;
    });
  }

  async recordSession(descriptor: AgentDaemonSessionDescriptor): Promise<void> {
    this.assertOpen();
    const state: SessionState = { descriptor, queuedMessages: this.sessionState(descriptor.sessionId)?.queuedMessages ?? [] };
    this.db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET workspace_id = excluded.workspace_id,
      connection_id = excluded.connection_id, state_json = excluded.state_json`)
      .run(descriptor.sessionId, descriptor.workspaceId, descriptor.connectionId, JSON.stringify(state));
  }

  async updateSessionLaunchConfig(sessionId: string, launchConfig: AgentDaemonSessionDescriptor["launchConfig"]): Promise<void> {
    this.assertOpen();
    const state = this.sessionState(sessionId);
    if (!state) return;
    state.descriptor = { ...state.descriptor, launchConfig };
    this.db.prepare("UPDATE sessions SET state_json = ? WHERE session_id = ?").run(JSON.stringify(state), sessionId);
  }

  async saveSessionQueue(sessionId: string, messages: readonly AgentQueuedMessage[]): Promise<void> {
    this.assertOpen();
    const state = this.sessionState(sessionId);
    if (!state) return;
    state.queuedMessages = [...messages];
    this.db.prepare("UPDATE sessions SET state_json = ? WHERE session_id = ?").run(JSON.stringify(state), sessionId);
  }

  private deleteMatchingSessions(column: "workspace_id" | "connection_id", id: string): string[] {
    return transaction(this.db, () => {
      const removed = this.db.prepare(`SELECT session_id FROM sessions WHERE ${column} = ? ORDER BY rowid`).all(id).map((row) => String(row.session_id));
      for (const sessionId of removed) this.db.prepare("DELETE FROM commands WHERE session_id = ?").run(sessionId);
      this.db.prepare(`DELETE FROM sessions WHERE ${column} = ?`).run(id);
      return removed;
    });
  }

  async deleteSession(sessionId: string): Promise<string[]> {
    this.assertOpen();
    return transaction(this.db, () => {
      const exists = Boolean(this.sessionState(sessionId));
      this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM commands WHERE session_id = ?").run(sessionId);
      return exists ? [sessionId] : [];
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<string[]> { this.assertOpen(); return this.deleteMatchingSessions("workspace_id", workspaceId); }
  async deleteConnection(connectionId: string): Promise<string[]> { this.assertOpen(); return this.deleteMatchingSessions("connection_id", connectionId); }
  async deleteAllSessions(): Promise<string[]> {
    this.assertOpen();
    return transaction(this.db, () => {
      const removed = this.sessionIds();
      this.db.exec("DELETE FROM sessions; DELETE FROM commands WHERE session_id IS NOT NULL");
      return removed;
    });
  }

  async flush(): Promise<void> {
    this.assertOpen();
    // Each public mutation is already committed with synchronous=FULL.
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.lifecycle = "closing";
    this.closePromise = (async () => {
      try {
        // Close/checkpoint is maintenance only: durability never depends on it.
        const meta = this.metadata();
        if (meta.next === meta.acknowledged) this.db.exec("PRAGMA incremental_vacuum");
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        try { this.db.close(); } finally {
          this.lifecycle = "closed";
          await this.lock.release();
        }
      }
    })();
    return this.closePromise;
  }

  private assertOpen(): void {
    if (this.lifecycle !== "open") throw new Error("Host Connector state journal is closed.");
  }
}
