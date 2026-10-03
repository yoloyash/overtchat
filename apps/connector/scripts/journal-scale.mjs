import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { ConnectorStateJournal } from "../src/state.ts";
import { ConnectorClient } from "../src/client.ts";

const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-journal-scale-"));
const file = path.join(directory, "state.json");
const expected = createHash("sha256");
const received = createHash("sha256");
let client;
let server;
const start = performance.now();
const session = (index) => ({
  descriptor: { connectionId: "connection", workspaceId: "workspace", provider: "codex",
    target: { transport: "local", shellMode: "interactive" }, executable: "codex", cwd: "/synthetic",
    sessionId: `session-${index}`, providerSessionId: `native-${index}`, providerSessionPath: `/synthetic/${index}.jsonl`, launchConfig: {} },
  queuedMessages: [{ id: `queue-${index}`, message: "synthetic pending message", status: "uncertain" }],
});
try {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile('{"format":3,"connectorEpoch":"incident-scale-epoch","nextEventSequence":533595,"acknowledgedSequence":533317,"events":[');
    for (let index = 0; index < 278; index++) {
      const text = index < 91 ? "x".repeat(3_111_500) : index < 187 ? "y".repeat(223_500) : "small";
      const event = { sequence: 533318 + index, payload: { type: "response", requestId: `request-${index}`, success: true,
        data: { snapshot: { text }, sync: { snapshot: { text } } } } };
      const json = JSON.stringify(event);
      expected.update(json + "\n");
      await handle.writeFile((index ? "," : "") + json);
    }
    await handle.writeFile('],"commands":[');
    for (let index = 0; index < 6338; index++) {
      const entry = { commandId: `command-${index}`, sessionId: `session-${index % 412}`, fingerprint: "a".repeat(64),
        ...(index % 2 ? { status: "completed", result: { success: true, data: { accepted: true } } } : { status: "pending" }) };
      await handle.writeFile((index ? "," : "") + JSON.stringify(entry));
    }
    await handle.writeFile('],"sessions":{');
    for (let index = 0; index < 412; index++) await handle.writeFile((index ? "," : "") + JSON.stringify(`session-${index}`) + ":" + JSON.stringify(session(index)));
    await handle.writeFile("}}\n");
    await handle.sync();
  } finally { await handle.close(); }
  const inputBytes = (await stat(file)).size;
  assert(inputBytes > 609_000_000 && inputBytes < 620_000_000);
  global.gc?.();
  const migrationStart = performance.now();
  const journal = await ConnectorStateJournal.open(file);
  const migrationMs = performance.now() - migrationStart;
  assert.equal(journal.connectorEpoch, "incident-scale-epoch");
  assert.equal(journal.sessionIds().length, 412);
  for (const index of [0, 1, 411, 6337]) {
    const result = await journal.beginCommand(`command-${index}`, `session-${index % 412}`, "a".repeat(64));
    assert.equal(result.status, index % 2 ? "completed" : "pending");
  }
  assert.deepEqual(journal.sessionQueue("session-411"), session(411).queuedMessages);
  await journal.close();
  global.gc?.();
  let deliveries = 0;
  let errors = 0;
  let eventCount = 0;
  let maxRequestBytes = 0;
  let lastSequence = 533317;
  let finish;
  let fail;
  const drained = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  server = createServer(async (request, response) => {
    try {
      if (!request.url?.endsWith("/events")) {
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        response.write("\n");
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) { size += chunk.length; assert(size <= 8 * 1024 * 1024); chunks.push(chunk); }
      maxRequestBytes = Math.max(maxRequestBytes, size);
      const batch = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!deliveries++) { errors++; response.writeHead(400); response.end("injected delivery failure"); return; }
      assert.equal(batch.connectorEpoch, "incident-scale-epoch");
      for (const event of batch.events) {
        assert.equal(event.sequence, ++lastSequence);
        received.update(JSON.stringify(event) + "\n");
        eventCount++;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ connectorEpoch: batch.connectorEpoch, acknowledgedSequence: lastSequence }));
      if (eventCount === 278) finish();
    } catch (error) { response.writeHead(500); response.end(); fail(error); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.OVERTCHAT_CONNECTOR_STATE = file;
  process.env.OVERTCHAT_CONNECTOR_LOCK = path.join(directory, "connector.lock");
  process.env.OVERTCHAT_CONNECTOR_TIMELINES = path.join(directory, "timelines");
  const startupStart = performance.now();
  client = await ConnectorClient.create({ connectorId: "scale", token: "synthetic-only", serverUrl: `http://127.0.0.1:${server.address().port}` });
  const startupMs = performance.now() - startupStart;
  const drainStart = performance.now();
  const run = client.run();
  const timeout = setTimeout(() => fail(new Error("Incident-scale drain timed out")), 90_000);
  try { await drained; } finally { clearTimeout(timeout); }
  // The HTTP receiver finishing is not yet a durable sender acknowledgement.
  // Wait for the client's commit before stopping/aborting its transport.
  const ackDeadline = Date.now() + 5000;
  while (Reflect.get(client, "journal").eventBatch().length) {
    assert(Date.now() < ackDeadline, "Final acknowledgement was not committed");
    await delay(10);
  }
  await client.stop();
  await run;
  client = undefined;
  const drainMs = performance.now() - drainStart;
  assert.equal(received.digest("hex"), expected.digest("hex"));
  const restored = await ConnectorStateJournal.open(file);
  assert.equal(restored.eventBatch().length, 0);
  assert.equal(restored.sessionIds().length, 412);
  assert.equal(restored.commandEntry("command-6337").status, "completed");
  assert.equal(restored.commandEntry("command-0").status, "pending");
  await restored.close();
  assert(!(await readdir(directory)).some((name) => name.includes("sqlite-migration") || name.endsWith(".tmp")));
  console.log(JSON.stringify({ inputBytes, events: eventCount, commands: 6338, sessions: 412, injectedHttpFailures: errors,
    requests: deliveries, maxRequestBytes, migrationMs: Math.round(migrationMs), startupMs: Math.round(startupMs),
    drainMs: Math.round(drainMs), elapsedMs: Math.round(performance.now() - start), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    databaseBytesAfterDrain: (await stat(file)).size, orphanTemporaryFiles: 0 }, null, 2));
} finally {
  await client?.stop();
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await rm(directory, { recursive: true, force: true });
}
