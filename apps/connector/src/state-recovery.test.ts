import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOST_CONNECTOR_EVENT_BATCH_BYTES } from "@overtchat/agent-bridge";
import { ConnectorStateJournal } from "./state.js";
import { backupConnectorJournal } from "./journal-backup.js";

const faults = vi.hoisted(() => ({ publicationFull: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => {
    if (faults.publicationFull) {
      faults.publicationFull = false;
      throw Object.assign(new Error("Disk full while publishing migration"), { code: "ENOSPC" });
    }
    return actual.rename(...args);
  } };
});

const directories: string[] = [];
const children = new Set<ChildProcess>();
const worker = fileURLToPath(new URL("./test-support/journal-crash-worker.ts", import.meta.url));
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-recovery-"));
  directories.push(directory);
  return { directory, file: path.join(directory, "state.json") };
}
const response = (id: string, data: unknown = null) => ({ type: "response" as const, requestId: id, success: true as const, data });
function legacy() {
  return { format: 3, connectorEpoch: "legacy-epoch", nextEventSequence: 2, acknowledgedSequence: 0,
    events: [{ sequence: 1, payload: response("first", "x".repeat(100_000)) }, { sequence: 2, payload: response("second") }], commands: [], sessions: {} };
}
afterEach(async () => {
  faults.publicationFull = false;
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function killAt(file: string, action: string, boundary: string) {
  const child = spawn(process.execPath, ["--import", "tsx", worker, file, action, boundary], { stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let stderr = "";
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const exit = once(child, "exit");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Crash worker timed out: ${stderr}`)); }, 15_000);
    child.stdout!.on("data", (chunk) => { if (String(chunk).includes("ready")) { clearTimeout(timeout); resolve(); } });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error(`Crash worker exited before readiness: ${stderr}`)); });
  });
  child.kill("SIGKILL");
  expect(await exit).toEqual([null, "SIGKILL"]);
  children.delete(child);
}

describe("connector journal crash recovery", () => {
  it("preserves original state and retries after ENOSPC publishing a committed migration", async () => {
    const { file } = await fixture();
    const original = JSON.stringify(legacy());
    await writeFile(file, original);
    faults.publicationFull = true;
    await expect(ConnectorStateJournal.open(file)).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await readFile(file, "utf8")).toBe(original);
    expect(await readFile(`${file}.legacy`, "utf8")).toBe(original);
    const recovered = await ConnectorStateJournal.open(file);
    expect(recovered.eventBatch().map((event) => event.sequence)).toEqual([1, 2]);
    await recovered.close();
  });
  it.each(["enqueue", "begin", "complete", "ack"])("recovers %s killed before commit", async (action) => {
    const { file, directory } = await fixture();
    const seed = await ConnectorStateJournal.open(file);
    seed.enqueue(response("original"));
    await seed.beginCommand("command", "session", "a".repeat(64));
    const epoch = seed.connectorEpoch;
    await seed.close();
    await killAt(file, action, "before-commit");
    const recovered = await ConnectorStateJournal.open(file);
    expect(recovered.connectorEpoch).toBe(epoch);
    expect(recovered.eventBatch().map((event) => event.payload)).toEqual([response("original")]);
    expect(recovered.commandEntry("new-command")).toBeUndefined();
    await expect(recovered.beginCommand("command", "session", "a".repeat(64))).resolves.toEqual({ status: "pending" });
    await recovered.close();
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp") || name.includes("sqlite-migration"))).toEqual([]);
  });
  it.each(["enqueue", "begin", "complete", "ack"])("retains %s killed immediately after commit", async (action) => {
    const { file } = await fixture();
    const seed = await ConnectorStateJournal.open(file);
    seed.enqueue(response("original"));
    await seed.beginCommand("command", "session", "a".repeat(64));
    await seed.close();
    await killAt(file, action, "after-commit");
    const recovered = await ConnectorStateJournal.open(file);
    const ids = recovered.eventBatch().map((event) => event.payload.type === "response" ? event.payload.requestId : "unexpected");
    expect(ids).toEqual(action === "ack" ? [] : action === "enqueue" ? ["original", "new-event"] : ["original"]);
    if (action === "begin") await expect(recovered.beginCommand("new-command", "session", "b".repeat(64))).resolves.toEqual({ status: "pending" });
    if (action === "complete") await expect(recovered.beginCommand("command", "session", "a".repeat(64))).resolves.toEqual({ status: "completed", result: { success: true, data: { accepted: true } } });
    await recovered.close();
  });
  it.each(["during-import", "before-commit", "after-commit", "published"])("resumes migration killed at %s", async (boundary) => {
    const { file, directory } = await fixture();
    const original = JSON.stringify(legacy());
    await writeFile(file, original);
    await killAt(file, "migrate", boundary);
    if (boundary !== "published") expect(await readFile(file, "utf8")).toBe(original);
    const recovered = await ConnectorStateJournal.open(file);
    expect(recovered.connectorEpoch).toBe("legacy-epoch");
    expect(recovered.eventBatch().map((event) => event.sequence)).toEqual([1, 2]);
    await recovered.close();
    expect(await readFile(`${file}.legacy`, "utf8")).toBe(original);
    expect((await readdir(directory)).filter((name) => name.includes("sqlite-migration"))).toEqual([]);
  });
  it("takes a self-contained backup of committed rows left in WAL by SIGKILL", async () => {
    const { file, directory } = await fixture();
    const seed = await ConnectorStateJournal.open(file);
    await seed.close();
    await killAt(file, "enqueue", "after-commit");
    const backup = path.join(directory, "snapshot");
    await backupConnectorJournal(file, backup);
    expect((await readdir(directory)).filter((name) => name.startsWith("snapshot-"))).toEqual([]);
    const restored = await ConnectorStateJournal.open(backup);
    expect(restored.eventBatch().map((event) => event.payload)).toEqual([response("new-event", "committed response")]);
    await restored.close();
  });
  it("cleans only abandoned matching regular temporary files while holding the journal lock", async () => {
    const { file, directory } = await fixture();
    const suffix = `${crypto.randomUUID()}.tmp`;
    const abandoned = `${file}.2147483647.${suffix}`;
    const live = `${file}.${process.pid}.${suffix}`;
    const unrelated = path.join(directory, `other.state.json.2147483647.${suffix}`);
    const target = path.join(directory, "keep-transcript");
    const symbolic = `${file}.2147483646.${suffix}`;
    for (const name of [abandoned, live, unrelated, target, `${file}.previous`]) await writeFile(name, "preserve except orphan");
    await symlink(target, symbolic);
    const journal = await ConnectorStateJournal.open(file);
    expect(await readdir(directory)).not.toContain(path.basename(abandoned));
    for (const name of [live, unrelated, target, symbolic, `${file}.previous`]) expect(await readFile(name, "utf8")).toBe("preserve except orphan");
    await expect(ConnectorStateJournal.open(file)).rejects.toThrow("already running");
    await journal.close();
  });
  it("rolls back a real SQLITE_FULL write without advancing sequence or losing existing events", async () => {
    const { file } = await fixture();
    const journal = await ConnectorStateJournal.open(file);
    journal.enqueue(response("original"));
    const db = Reflect.get(journal, "db") as DatabaseSync;
    const pages = Number(db.prepare("PRAGMA page_count").get()!.page_count);
    db.exec(`PRAGMA max_page_count = ${pages}`);
    expect(() => journal.enqueue(response("too-large", "x".repeat(2 * 1024 * 1024)))).toThrow(/full/iu);
    expect(journal.eventBatch().map((event) => event.sequence)).toEqual([1]);
    db.exec("PRAGMA max_page_count = 1073741823");
    expect(journal.enqueue(response("retry")).sequence).toBe(2);
    await journal.close();
    const recovered = await ConnectorStateJournal.open(file);
    expect(recovered.eventBatch().map((event) => event.payload)).toEqual([response("original"), response("retry")]);
    await recovered.close();
  });
  it("bounds reads by UTF-8 bytes and keeps oversized individual events deliverable", async () => {
    const { file } = await fixture();
    const journal = await ConnectorStateJournal.open(file);
    const unicode = "😀".repeat(750_000);
    for (let index = 0; index < 5; index++) journal.enqueue(response(String(index), unicode));
    const batch = journal.eventBatch();
    expect(batch).toHaveLength(2);
    expect(Buffer.byteLength(JSON.stringify(batch)) + 4096).toBeLessThan(HOST_CONNECTOR_EVENT_BATCH_BYTES);
    await journal.acknowledge({ connectorEpoch: journal.connectorEpoch, acknowledgedSequence: 5 });
    journal.enqueue(response("oversized", "x".repeat(HOST_CONNECTOR_EVENT_BATCH_BYTES + 1)));
    journal.enqueue(response("next"));
    expect(journal.eventBatch()).toHaveLength(1);
    await journal.close();
  });
});
