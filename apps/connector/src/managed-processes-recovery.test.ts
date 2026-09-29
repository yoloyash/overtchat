import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostTarget } from "@overtchat/agent-runtime";

const control = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  return {
    ...actual,
    execFile: Object.assign(actual.execFile.bind(null), {
      [promisify.custom]: control.run,
    }),
  };
});

import { ManagedProcesses } from "./managed-processes.js";
import { ConnectorClient } from "./client.js";

const directories: string[] = [];
const pid = 4242;
const started = "Thu Sep 24 05:00:00 2026";
const targets: HostTarget[] = [
  { transport: "local" },
  { transport: "ssh", alias: "test-host" },
];

function row(command: string, start = started) {
  return `${pid} 1 ${pid} Ss ${start} ${command}\n`;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  control.run.mockReset();
});

it("connects while SSH recovery is stalled and cancels recovery before releasing its lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-startup-recovery-"));
  directories.push(directory);
  const state = path.join(directory, "state.json");
  const ledger = `${state}.processes`;
  const lock = path.join(directory, "connector.lock");
  await mkdir(ledger);
  for (let index = 0; index < 5; index++) {
    const id = randomUUID();
    await writeFile(path.join(ledger, `${id}.json`), JSON.stringify({
      id, target: { transport: "ssh", alias: "offline-fixture" },
      root: { pid, started }, signature: "fixture-only", descendants: [],
    }));
  }
  vi.stubEnv("OVERTCHAT_CONNECTOR_STATE", state);
  vi.stubEnv("OVERTCHAT_CONNECTOR_TIMELINES", path.join(directory, "timelines"));
  vi.stubEnv("OVERTCHAT_CONNECTOR_LOCK", lock);
  const probes: AbortSignal[] = [];
  let lockHeldDuringAbort = false;
  control.run.mockImplementation(async (_command, _args, options) => {
    const signal = options.signal as AbortSignal;
    probes.push(signal);
    return new Promise((_, reject) => signal.addEventListener("abort", () => {
      void readFile(lock).then(() => { lockHeldDuringAbort = true; }).finally(() => reject(new Error("aborted")));
    }, { once: true }));
  });
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    requests.push(String(url));
    return new Response(new ReadableStream({ start(controller) { controller.close(); } }));
  }));
  const client = await ConnectorClient.create({ serverUrl: "http://127.0.0.1:4717", connectorId: "fixture", token: "fixture" });
  const running = client.run();
  try {
    await vi.waitFor(() => {
      expect(requests).toContain("http://127.0.0.1:4717/api/host-connectors/channel");
      expect(probes).toHaveLength(1);
    });
  } finally {
    await client.stop();
    await running;
  }
  expect(probes[0].aborted).toBe(true);
  expect(lockHeldDuringAbort).toBe(true);
  expect(await readdir(ledger)).toHaveLength(5);
  await expect(readFile(lock)).rejects.toMatchObject({ code: "ENOENT" });
});

it("shares in-flight startup cleanup with recovery for a new launch on the same target", async () => {
  const target = { transport: "ssh" as const, alias: "test-host" };
  const f = await fixture(target);
  let release!: () => void;
  control.run.mockImplementationOnce(() => new Promise(resolve => {
    release = () => resolve({ stdout: "", stderr: "" });
  }));
  f.manager.startRecovery();
  await vi.waitFor(() => expect(control.run).toHaveBeenCalledOnce());
  const spawn = vi.fn(() => { throw new Error("fixture launch reached"); });
  const launch = f.manager.spawn(target, { command: "fixture", shellMode: "login" }, spawn);
  const assertion = expect(launch).rejects.toThrow("fixture launch reached");
  try {
    // Give the second ledger read time to reach the shared termination promise.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(spawn).not.toHaveBeenCalled();
    expect(control.run).toHaveBeenCalledOnce();
  } finally {
    release();
    await assertion;
    await f.manager.stop();
  }
  expect(spawn).toHaveBeenCalledOnce();
  expect(await readdir(f.directory)).toEqual([]);
});

async function fixture(target: HostTarget) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-recovery-"));
  directories.push(directory);
  const id = randomUUID();
  const record = {
    id,
    target,
    root: { pid, started },
    signature: "sleep 60",
    descendants: [] as { pid: number; started: string }[],
  };
  const file = path.join(directory, `${id}.json`);
  await writeFile(file, JSON.stringify(record));
  const signals: string[] = [];
  let snapshots = [""];
  let probes = 0;
  const probesAtSignal: number[] = [];
  // Mock only OS observations/signals. Reconciliation and ledger I/O run for
  // real, with snapshots capturing the missing-argv state observed during exec.
  control.run.mockImplementation(async (command: string, args: string[]) => {
    expect(command).toBe(target.transport === "local" ? "/bin/sh" : "ssh");
    if (target.transport === "ssh") expect(args).toContain(target.alias);
    const script = args.at(-1)!;
    if (script.includes("ps -axww")) {
      probes++;
      const stdout = snapshots[0];
      if (snapshots.length > 1) snapshots.shift();
      return { stdout, stderr: "" };
    }
    if (script.includes("kill -")) {
      signals.push(script);
      probesAtSignal.push(probes);
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected control command: ${command}`);
  });
  return {
    directory,
    file,
    record,
    signals,
    probesAtSignal,
    manager: new ManagedProcesses(directory),
    snapshots: (...values: string[]) => { snapshots = values; },
  };
}

describe.each(targets)("managed recovery over $transport", (target) => {
  it("waits for transient missing argv before signalling the verified helper", async () => {
    const f = await fixture(target);
    f.snapshots(row("[sleep]"), row("/bin/sleep 60"), "");
    await f.manager.reap();
    expect(f.probesAtSignal).toEqual([2]);
    expect(f.signals).toHaveLength(1);
    expect(f.signals[0]).toContain(`kill -TERM ${pid}`);
    expect(await readdir(f.directory)).toEqual([]);
  });

  it.each([
    { command: "[sleep]", hasDescendant: false },
    { command: "different-program", hasDescendant: false },
    { command: "[sleep]", hasDescendant: true },
    { command: "different-program", hasDescendant: true },
  ])(
    "retains an uncertain root ($command, descendant: $hasDescendant) for a later retry",
    async ({ command, hasDescendant }) => {
      const f = await fixture(target);
      f.record.descendants = hasDescendant ? [{ pid: pid + 1, started }] : [];
      await writeFile(f.file, JSON.stringify(f.record));
      const descendant = hasDescendant
        ? `${pid + 1} 1 ${pid} S ${started} worker\n`
        : "";
      f.snapshots(row(command) + descendant);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      await f.manager.reap();
      expect(f.signals).toEqual([]);
      expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual(f.record);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(
        "still running but ownership could not be confirmed; retaining recovery record",
      ));
      f.snapshots(row("/bin/sleep 60") + descendant, "");
      await f.manager.reap();
      expect(f.signals).toHaveLength(1);
      expect(f.signals[0]).toContain(
        `kill -TERM ${pid}${hasDescendant ? ` ${pid + 1}` : ""} 2>/dev/null`,
      );
      expect(await readdir(f.directory)).toEqual([]);
    },
  );

  it("removes the record if the uncertain helper exits during verification", async () => {
    const f = await fixture(target);
    f.snapshots(row("[sleep]"), "");
    await f.manager.reap();
    expect(f.signals).toEqual([]);
    expect(await readdir(f.directory)).toEqual([]);
  });

  it("discards a stale record without signalling a reused PID", async () => {
    const f = await fixture(target);
    f.snapshots(row("/bin/sleep 60", "Thu Sep 24 06:00:00 2026"));
    await f.manager.reap();
    expect(f.signals).toEqual([]);
    expect(await readdir(f.directory)).toEqual([]);
  });

  it("recovers recorded descendants after their root has exited", async () => {
    const f = await fixture(target);
    f.record.descendants = [{ pid: pid + 1, started }];
    await writeFile(f.file, JSON.stringify(f.record));
    f.snapshots(`${pid + 1} 1 ${pid} S ${started} worker\n`, "");
    await f.manager.reap();
    expect(f.signals).toHaveLength(1);
    expect(f.signals[0]).toContain(`kill -TERM ${pid + 1}`);
    expect(await readdir(f.directory)).toEqual([]);
  });
});
