import { writeSync } from "node:fs";
import { ConnectorStateJournal } from "../state.js";
import type { JournalDatabase } from "../journal-sqlite.js";

const driverName = process.versions.bun ? "bun:sqlite" : "node:sqlite";
const driver = await import(driverName) as {
  Database: { prototype: JournalDatabase };
  DatabaseSync: { prototype: JournalDatabase };
};
const prototype = (process.versions.bun ? driver.Database : driver.DatabaseSync).prototype;

const [file, action, boundary] = process.argv.slice(2);
if (!file || !action || !boundary) throw new Error("Missing crash worker arguments.");
let armed = action === "migrate";
const pause = () => {
  writeSync(1, "ready\n");
  // The parent sends a real SIGKILL. No JS cleanup or close can run.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const originalExec = prototype.exec;
prototype.exec = function (sql: string) {
  if (armed && sql === "COMMIT" && boundary === "before-commit") pause();
  originalExec.call(this, sql);
  if (armed && sql === "COMMIT" && boundary === "after-commit") pause();
};
const prepareName = process.versions.bun ? "query" : "prepare";
const originalPrepare = prototype[prepareName]!;
prototype[prepareName] = function (sql: string) {
  const statement = originalPrepare.call(this, sql);
  if (armed && boundary === "during-import" && sql.startsWith("INSERT INTO imported_events")) {
    const run = statement.run.bind(statement);
    Reflect.set(statement, "run", (...args: unknown[]) => {
      const result = Reflect.apply(run, statement, args);
      pause();
      return result;
    });
  }
  return statement;
};

const journal = await ConnectorStateJournal.open(file);
armed = true;
switch (action) {
  case "enqueue": journal.enqueue({ type: "response", requestId: "new-event", success: true, data: "committed response" }); break;
  case "begin": await journal.beginCommand("new-command", "session", "b".repeat(64)); break;
  case "complete": await journal.completeCommand("command", "session", "a".repeat(64), { success: true, data: { accepted: true } }); break;
  case "ack": await journal.acknowledge({ connectorEpoch: journal.connectorEpoch, acknowledgedSequence: 1 }); break;
  case "migrate": break;
  default: throw new Error("Unknown crash action.");
}
pause();
