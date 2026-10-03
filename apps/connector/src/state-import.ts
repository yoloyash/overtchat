import { createReadStream } from "node:fs";
import { chmod, link, lstat, open, readdir, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { JSONParser, TokenType } from "@streamparser/json";
import { isHostConnectorEvent } from "@overtchat/agent-bridge";
import { isCommandEntry, isCommandResult, isRecord, isSessionState, stableCommandResult } from "./state-format.js";
import { configureJournalDatabase, createJournalSchema, openJournalDatabase, syncJournalFile, type JournalDatabase } from "./journal-sqlite.js";

export async function journalFileKind(file: string): Promise<"missing" | "json" | "sqlite"> {
  let handle;
  try { handle = await open(file, "r"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
  try {
    const header = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    return header.toString("utf8") === "SQLite format 3\0" ? "sqlite" : "json";
  } finally { await handle.close(); }
}

// Caller owns the journal instance lock. Never follow symlinks or remove
// unrelated journals, histories, rollback files, or files with a live writer.
export async function cleanJournalArtifacts(file: string): Promise<void> {
  const directory = path.dirname(file);
  const prefix = path.basename(file);
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const oldWrite = new RegExp(`^${escaped}\\.([1-9][0-9]*)\\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.tmp$`, "u");
  const migration = `${prefix}.sqlite-migration`;
  for (const name of await readdir(directory)) {
    const match = oldWrite.exec(name);
    if (!match && ![migration, `${migration}-wal`, `${migration}-shm`].includes(name)) continue;
    if (match) {
      try { process.kill(Number(match[1]), 0); continue; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
      }
    }
    const candidate = path.join(directory, name);
    if ((await lstat(candidate)).isFile()) await rm(candidate);
  }
}

async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function archiveOriginal(file: string): Promise<void> {
  const archive = `${file}.legacy`;
  try { await link(file, archive); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (await digest(file) !== await digest(archive)) {
      throw new Error(`A different legacy journal already exists at ${archive}; preserve it before retrying migration.`);
    }
  }
}

// Stream individual entries into an uncommitted staging database. keepStack
// false is essential: retaining emitted siblings would recreate the outage.
async function importJson(file: string, db: JournalDatabase): Promise<void> {
  const scalar: Record<string, unknown> = {};
  const rootKeys = new Set<string>();
  let depth = 0;
  let expectKey = true;
  let pendingKey: string | undefined;
  let eventIndex = 0;
  let previousSequence: number | undefined;
  let ordered = true;
  const parser = new JSONParser({
    paths: ["$.format", "$.connectorEpoch", "$.nextEventSequence", "$.acknowledgedSequence",
      "$.events.*", "$.commands.*", "$.commandResults.*", "$.sessions.*"],
    keepStack: false,
    stringBufferSize: 64 * 1024,
  });
  parser.onToken = ({ token, value }) => {
    if (depth === 0 && token !== TokenType.LEFT_BRACE && rootKeys.size === 0) {
      throw new Error("Invalid Host Connector state journal.");
    }
    if (depth === 1 && expectKey && token === TokenType.STRING) {
      pendingKey = String(value);
      if (rootKeys.has(pendingKey)) throw new Error("Invalid Host Connector duplicate journal field.");
      rootKeys.add(pendingKey);
      expectKey = false;
    } else if (depth === 1 && pendingKey && token !== TokenType.COLON) {
      if (["events", "commands", "commandResults"].includes(pendingKey) && token !== TokenType.LEFT_BRACKET ||
          pendingKey === "sessions" && token !== TokenType.LEFT_BRACE) {
        throw new Error("Invalid Host Connector state journal.");
      }
      pendingKey = undefined;
    }
    if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) depth++;
    if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) depth--;
    if (token === TokenType.COMMA && depth === 1) expectKey = true;
  };
  db.exec("CREATE TABLE imported_events (position INTEGER PRIMARY KEY, sequence INTEGER, kind TEXT, payload_json TEXT, bytes INTEGER)");
  const insertEvent = db.prepare("INSERT INTO imported_events VALUES (?, ?, ?, ?, ?)");
  const insertCommand = db.prepare("INSERT INTO commands VALUES (?, ?, ?)");
  const insertSession = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)");
  parser.onValue = ({ value, key, stack }) => {
    if (stack.length === 1) { scalar[String(key)] = value; return; }
    const section = stack[1]?.key;
    if (section === "events") {
      if (!isHostConnectorEvent(value)) throw new Error("Invalid Host Connector event journal.");
      if (previousSequence !== undefined && value.sequence !== previousSequence + 1) ordered = false;
      previousSequence = value.sequence;
      const json = JSON.stringify(value.payload);
      insertEvent.run(++eventIndex, value.sequence, value.payload.type, json, Buffer.byteLength(json) + 64);
    } else if (section === "commands" || section === "commandResults") {
      const entry = section === "commands" ? value :
        Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && value[0] && isCommandResult(value[1]) ?
          { commandId: value[0], sessionId: null, fingerprint: null, status: "completed", result: stableCommandResult(value[1]) } : null;
      if (!isCommandEntry(entry)) throw new Error("Invalid Host Connector command journal.");
      if (db.prepare("SELECT command_id FROM commands WHERE command_id = ?").get(entry.commandId)) {
        throw new Error("Invalid Host Connector command journal (duplicate identity).");
      }
      insertCommand.run(entry.commandId, entry.sessionId, JSON.stringify(entry));
    } else if (section === "sessions") {
      if (typeof key !== "string" || !key || !isRecord(value) || !isRecord(value.descriptor) || !Array.isArray(value.queuedMessages)) {
        throw new Error("Invalid Host Connector session journal.");
      }
      // The format can appear after the arrays, so apply v1/v2 defaults below.
      insertSession.run(String(key), String(value.descriptor.workspaceId ?? ""), String(value.descriptor.connectionId ?? ""), JSON.stringify(value));
    }
  };
  for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) parser.write(chunk);
  if (!parser.isEnded) parser.end();
  const format = scalar.format;
  if (![1, 2, 3].includes(format as number) ||
      typeof scalar.connectorEpoch !== "string" || !scalar.connectorEpoch ||
      !rootKeys.has("events") || !rootKeys.has("sessions") ||
      !rootKeys.has(format === 1 ? "commandResults" : "commands") ||
      rootKeys.has(format === 1 ? "commands" : "commandResults")) {
    throw new Error("Invalid Host Connector state journal.");
  }
  let epoch = scalar.connectorEpoch;
  let next = scalar.nextEventSequence;
  let acknowledged = scalar.acknowledgedSequence;
  if (format === 1) {
    epoch = crypto.randomUUID();
    acknowledged = 0;
    db.exec(`INSERT INTO events SELECT row_number() OVER (ORDER BY position), payload_json, bytes
      FROM imported_events WHERE kind != 'session_event' ORDER BY position`);
    next = db.prepare("SELECT count(*) AS count FROM events").get()!.count;
  } else {
    const bounds = db.prepare("SELECT count(*) AS count, min(sequence) AS first, max(sequence) AS last FROM imported_events").get()!;
    if (!Number.isSafeInteger(next) || Number(next) < 0 || !Number.isSafeInteger(acknowledged) ||
        Number(acknowledged) < 0 || Number(acknowledged) > Number(next) || !ordered ||
        bounds.count !== Number(next) - Number(acknowledged) ||
        Number(bounds.first ?? Number(acknowledged) + 1) !== Number(acknowledged) + 1 ||
        Number(bounds.last ?? acknowledged) !== next) {
      throw new Error("Invalid Host Connector event journal.");
    }
    db.exec("INSERT INTO events SELECT sequence, payload_json, bytes FROM imported_events ORDER BY position");
  }
  // Descriptors are small; validate in pages rather than loading every session.
  let cursor = "";
  for (;;) {
    const rows = db.prepare("SELECT session_id, state_json FROM sessions WHERE session_id > ? ORDER BY session_id LIMIT 64").all(cursor);
    if (!rows.length) break;
    for (const row of rows) {
      cursor = String(row.session_id);
      const state: unknown = JSON.parse(String(row.state_json));
      if (format !== 3 && isRecord(state) && isRecord(state.descriptor)) state.descriptor.launchConfig = {};
      if (!isSessionState(state, cursor)) throw new Error("Invalid Host Connector session journal.");
      db.prepare("UPDATE sessions SET state_json = ? WHERE session_id = ?").run(JSON.stringify(state), cursor);
    }
  }
  db.prepare("INSERT INTO metadata VALUES (1, ?, ?, ?)").run(epoch, Number(next), Number(acknowledged));
  db.exec("DROP TABLE imported_events");
}

export async function initializeJournalFile(file: string): Promise<void> {
  const kind = await journalFileKind(file);
  if (kind === "sqlite") return;
  const staging = `${file}.sqlite-migration`;
  const db = await openJournalDatabase(staging);
  try {
    // This must precede WAL/schema creation; setting it inside the schema
    // transaction silently leaves a new database in auto_vacuum=NONE.
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    configureJournalDatabase(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      createJournalSchema(db);
      if (kind === "json") await importJson(file, db);
      else db.prepare("INSERT INTO metadata VALUES (1, ?, 0, 0)").run(crypto.randomUUID());
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* SQLite may already have rolled back. */ }
      throw error;
    }
    db.exec("PRAGMA incremental_vacuum");
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (checkpoint?.busy !== 0) throw new Error("Cannot checkpoint the migrated Host Connector journal.");
  } finally { db.close(); }
  await chmod(staging, 0o600);
  await syncJournalFile(staging);
  if (kind === "json") await archiveOriginal(file);
  await rename(staging, file);
  await syncJournalFile(path.dirname(file));
  for (const suffix of ["-wal", "-shm"]) await rm(`${staging}${suffix}`, { force: true });
}
