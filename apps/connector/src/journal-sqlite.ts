import { chmod, open } from "node:fs/promises";

type SqlValue = string | number | null;
export type SqlRow = Record<string, string | number | null>;
export interface JournalStatement {
  run(...values: SqlValue[]): unknown;
  get(...values: SqlValue[]): SqlRow | undefined | null;
  all(...values: SqlValue[]): SqlRow[];
}
export interface JournalDatabase {
  exec(sql: string): void;
  prepare(sql: string): JournalStatement;
  query?(sql: string): JournalStatement;
  close(): void;
}

// The released Bun runtime exposes bun:sqlite, while source development uses
// Node 22. Keep the driver boundary small; both execute the same SQL/schema.
export async function openJournalDatabase(file: string): Promise<JournalDatabase> {
  const moduleName = process.versions.bun ? "bun:sqlite" : "node:sqlite";
  const driver = await import(moduleName) as {
    Database: new (file: string) => JournalDatabase;
    DatabaseSync: new (file: string) => JournalDatabase;
  };
  const Database = process.versions.bun ? driver.Database : driver.DatabaseSync;
  // Create with private permissions before SQLite can create its WAL/SHM.
  const handle = await open(file, "a", 0o600);
  await handle.close();
  await chmod(file, 0o600);
  const db = new Database(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA cache_size = -8192;");
    if (process.versions.bun) {
      // Bun owns/finalizes query()'s cached statements on close. In the pinned
      // runtime, prepare() leaves unmanaged statements alive after close(),
      // keeping the SQLite file handle open across migration's atomic rename.
      // Node owns all its statements and releases them when the database closes.
      return { exec: db.exec.bind(db), prepare: db.query!.bind(db), close: db.close.bind(db) };
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function transaction<T>(db: JournalDatabase, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* SQLite may already have rolled back. */ }
    throw error;
  }
}

export function configureJournalDatabase(db: JournalDatabase): void {
  // WAL lets each mutation persist only changed rows. FULL preserves the
  // journal-before-ack contract through power failure, not just process exits.
  // journal_size_limit applies after WAL resets; it is not a hard per-write cap.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA journal_size_limit = 33554432;
    PRAGMA wal_autocheckpoint = 1000;
  `);
}

export function createJournalSchema(db: JournalDatabase): void {
  db.exec(`
    CREATE TABLE metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      connector_epoch TEXT NOT NULL,
      next_sequence INTEGER NOT NULL CHECK (next_sequence >= 0),
      acknowledged_sequence INTEGER NOT NULL CHECK (
        acknowledged_sequence >= 0 AND acknowledged_sequence <= next_sequence
      )
    );
    CREATE TABLE events (
      sequence INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL,
      bytes INTEGER NOT NULL CHECK (bytes >= 0)
    );
    CREATE TABLE commands (
      command_id TEXT PRIMARY KEY,
      session_id TEXT,
      entry_json TEXT NOT NULL
    );
    CREATE INDEX commands_session ON commands(session_id);
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      state_json TEXT NOT NULL
    );
    PRAGMA user_version = 4;
  `);
}

export async function syncJournalFile(file: string): Promise<void> {
  const handle = await open(file, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
