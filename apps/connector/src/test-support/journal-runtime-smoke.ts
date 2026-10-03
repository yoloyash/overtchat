import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConnectorStateJournal } from "../state.js";
import { backupConnectorJournal } from "../journal-backup.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-native-journal-"));
const file = path.join(directory, "state.json");
try {
  const descriptor = { connectionId: "connection", workspaceId: "workspace", provider: "codex" as const,
    target: { transport: "local" as const, shellMode: "interactive" as const }, executable: "codex", cwd: "/synthetic",
    sessionId: "session", providerSessionId: "native", providerSessionPath: "/synthetic/native.jsonl", launchConfig: {} };
  const journal = await ConnectorStateJournal.open(file);
  const oldEpoch = journal.connectorEpoch;
  await journal.recordSession(descriptor);
  await journal.saveSessionQueue("session", [{ id: "message", message: "synthetic", status: "uncertain" }]);
  assert.deepEqual(await journal.beginCommand("command", "session", "a".repeat(64)), { status: "execute" });
  await journal.completeCommand("command", "session", "a".repeat(64), { success: true, data: { accepted: true } });
  journal.enqueue({ type: "response", requestId: "first", success: true, data: null });
  journal.enqueue({ type: "response", requestId: "large", success: true, data: "😀".repeat(3 * 1024 * 1024) });
  journal.enqueue({ type: "response", requestId: "last", success: true, data: null });
  assert.equal(journal.eventBatch().length, 1);
  await journal.acknowledge({ connectorEpoch: oldEpoch, acknowledgedSequence: 1 });
  assert.equal(journal.eventBatch().length, 1);
  assert.equal((await journal.acknowledge({ connectorEpoch: oldEpoch, acknowledgedSequence: 0 })), "rebased");
  assert.notEqual(journal.connectorEpoch, oldEpoch);
  assert.equal(journal.eventBatch()[0]?.sequence, 1);
  await journal.close();
  const restarted = await ConnectorStateJournal.open(file);
  assert.equal(restarted.sessionQueue("session")[0]?.status, "uncertain");
  assert.deepEqual(await restarted.beginCommand("command", "session", "a".repeat(64)), { status: "completed", result: { success: true, data: { accepted: true } } });
  await restarted.acknowledge({ connectorEpoch: restarted.connectorEpoch, acknowledgedSequence: 2 });
  assert.equal(restarted.eventBatch().length, 0);
  await restarted.close();
  assert((await stat(file)).size < 1024 * 1024, "Drained journal did not reclaim freed pages");
  const backup = path.join(directory, "snapshot");
  await backupConnectorJournal(file, backup);
  const restored = await ConnectorStateJournal.open(backup);
  assert.deepEqual(restored.sessionIdsForWorkspace("workspace"), ["session"]);
  assert.deepEqual(await restored.deleteConnection("connection"), ["session"]);
  assert.equal(restored.commandEntry("command"), undefined);
  await restored.close();
  console.log("Native journal: transactions, oversized UTF-8 batching, epoch rebase, restart, receipts, queues, compaction and backup passed.");
} finally { await rm(directory, { recursive: true, force: true }); }

if (process.argv.includes("--scale")) await import("../../scripts/journal-scale.mjs");
