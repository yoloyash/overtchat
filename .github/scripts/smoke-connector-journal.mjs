import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

const binary = path.resolve(process.argv[2] ?? "");
assert(process.argv[2], "Provide the packaged connector executable");
const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-packaged-journal-"));
try {
  const file = path.join(directory, "state.json");
  const config = path.join(directory, "connector.json");
  const snapshot = path.join(directory, "snapshot");
  const epoch = "packaged-journal-epoch";
  const fingerprint = "a".repeat(64);
  const payload = { type: "response", requestId: "pending-reply", success: true, data: "x".repeat(9 * 1024 * 1024) };
  const original = JSON.stringify({ format: 3, connectorEpoch: epoch, nextEventSequence: 42, acknowledgedSequence: 41,
    events: [{ sequence: 42, payload }], commands: [{ commandId: "pending-command", sessionId: "session", fingerprint, status: "pending" }], sessions: {} });
  await writeFile(file, original, { mode: 0o600 });
  await writeFile(config, JSON.stringify({ serverUrl: "http://127.0.0.1:9", connectorId: "smoke", token: "synthetic-only" }), { mode: 0o600 });
  const env = { ...process.env, OVERTCHAT_CONNECTOR_CONFIG: config, OVERTCHAT_CONNECTOR_STATE: file,
    OVERTCHAT_CONNECTOR_LOCK: path.join(directory, "connector.lock"), OVERTCHAT_CONNECTOR_TIMELINES: path.join(directory, "timelines") };
  const run = (...args) => {
    const result = spawnSync(binary, args, { encoding: "utf8", env, timeout: 30_000 });
    assert.equal(result.status, 0, `${args[0]} failed: ${result.error ?? result.stderr}`);
  };
  run("preflight");
  assert.equal(await readFile(file + ".legacy", "utf8"), original);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  run("preflight");
  run("journal-backup", "--destination", snapshot);
  const db = new DatabaseSync(snapshot, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4);
    assert.equal(db.prepare("PRAGMA auto_vacuum").get().auto_vacuum, 2);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual({ ...db.prepare("SELECT connector_epoch, next_sequence, acknowledged_sequence FROM metadata").get() },
      { connector_epoch: epoch, next_sequence: 42, acknowledged_sequence: 41 });
    assert.deepEqual(JSON.parse(String(db.prepare("SELECT payload_json FROM events").get().payload_json)), payload);
    assert.equal(JSON.parse(String(db.prepare("SELECT entry_json FROM commands").get().entry_json)).status, "pending");
  } finally { db.close(); }
  assert(!(await readdir(directory)).some((name) => name.endsWith(".tmp") || name.includes("sqlite-migration")));
  if (process.argv[3]) {
    const crashWorker = path.resolve(process.argv[3]);
    const killAt = async (stateFile, action, boundary) => {
      const child = spawn(crashWorker, [stateFile, action, boundary], { stdio: ["ignore", "pipe", "pipe"] });
      const exited = once(child, "exit");
      let errors = "";
      child.stderr.on("data", (chunk) => { errors += String(chunk); });
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Native crash worker timed out: ${errors}`)), 30_000);
          child.stdout.on("data", (chunk) => { if (String(chunk).includes("ready")) { clearTimeout(timeout); resolve(); } });
          child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Native crash worker exited early: ${errors}`)); });
          child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        });
      } finally { child.kill("SIGKILL"); }
      assert.deepEqual(await exited, [null, "SIGKILL"]);
    };
    const originalCrashState = JSON.stringify({ format: 3, connectorEpoch: "native-kill-epoch", nextEventSequence: 1, acknowledgedSequence: 0,
      events: [{ sequence: 1, payload: { type: "response", requestId: "original", success: true, data: null } }],
      commands: [{ commandId: "command", sessionId: "session", fingerprint, status: "pending" }], sessions: {} });
    for (const action of ["enqueue", "begin", "complete", "ack"]) {
      for (const boundary of ["before-commit", "after-commit"]) {
        const crashFile = path.join(directory, `${action}-${boundary}`);
        await writeFile(crashFile, originalCrashState, { mode: 0o600 });
        await killAt(crashFile, action, boundary);
        const state = new DatabaseSync(crashFile, { readOnly: true });
        try {
          assert.equal(state.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
          const count = Number(state.prepare("SELECT count(*) AS count FROM events").get().count);
          assert.equal(count, boundary === "before-commit" ? 1 : action === "enqueue" ? 2 : action === "ack" ? 0 : 1);
          const command = JSON.parse(String(state.prepare("SELECT entry_json FROM commands WHERE command_id = 'command'").get().entry_json));
          assert.equal(command.status, boundary === "after-commit" && action === "complete" ? "completed" : "pending");
          assert.equal(Boolean(state.prepare("SELECT command_id FROM commands WHERE command_id = 'new-command'").get()), boundary === "after-commit" && action === "begin");
        } finally { state.close(); }
      }
    }
    for (const boundary of ["during-import", "before-commit", "after-commit"]) {
      const crashFile = path.join(directory, `migration-${boundary}`);
      await writeFile(crashFile, originalCrashState, { mode: 0o600 });
      await killAt(crashFile, "migrate", boundary);
      assert.equal(await readFile(crashFile, "utf8"), originalCrashState);
      const recovered = spawnSync(binary, ["preflight"], { encoding: "utf8", timeout: 30_000, env: { ...env, OVERTCHAT_CONNECTOR_STATE: crashFile } });
      assert.equal(recovered.status, 0, recovered.stderr);
      const state = new DatabaseSync(crashFile, { readOnly: true });
      try { assert.equal(state.prepare("SELECT count(*) AS count FROM events").get().count, 1); }
      finally { state.close(); }
    }
    console.log("Native SIGKILL: all 8 commit boundaries and 3 interrupted migrations recovered correctly.");
  }
  console.log("Packaged connector: migration, restart, private permissions, pending receipts, oversized event and standalone backup passed.");
} finally { await rm(directory, { recursive: true, force: true }); }
