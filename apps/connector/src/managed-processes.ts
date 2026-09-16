import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { promisify } from "node:util";
import type {
  AgentProcess,
  AgentProcessHostLaunch,
  HostTarget,
  ProcessSpawner,
} from "@overtchat/agent-runtime";
import { buildSshRemoteCommand, shellQuote, sshCommandArgs } from "./ssh.js";

const execFileAsync = promisify(execFile);
const GRACE_MS = 1_000;
const CONTROL_TIMEOUT_MS = 10_000;
type Identity = { pid: number; started: string };
type ProcessRow = Identity & {
  ppid: number;
  pgid: number;
  state: string;
  command: string;
};
type Record = {
  id: string;
  target: HostTarget;
  root: Identity;
  signature: string;
  descendants: Identity[];
};

async function control(target: HostTarget, script: string): Promise<string> {
  const launch = {
    command: "/bin/sh",
    args: ["-c", script],
    shellMode: "login" as const,
  };
  const result =
    target.transport === "local"
      ? await execFileAsync(launch.command, launch.args, {
          timeout: CONTROL_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
        })
      : await execFileAsync(
          "ssh",
          sshCommandArgs(target.alias, `/bin/sh -c ${shellQuote(script)}`),
          {
            timeout: CONTROL_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
  return result.stdout;
}

export function parseProcessTable(output: string): ProcessRow[] {
  return output.split("\n").flatMap((line) => {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/u.exec(
        line,
      );
    if (!match || match[4].startsWith("Z")) return [];
    return [
      {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        state: match[4],
        started: match[5].replace(/\s+/gu, " "),
        command: match[6],
      },
    ];
  });
}

async function processTable(target: HostTarget): Promise<ProcessRow[]> {
  return parseProcessTable(
    await control(
      target,
      "LC_ALL=C ps -axww -o pid=,ppid=,pgid=,stat=,lstart=,args=",
    ),
  );
}

function sameProcess(identity: Identity, row: ProcessRow): boolean {
  return identity.pid === row.pid && identity.started === row.started;
}

function ownedTree(record: Record, rows: ProcessRow[]): ProcessRow[] {
  const root = rows.find((row) => sameProcess(record.root, row));
  const ownsRoot =
    root &&
    (root.command.includes(`overtchat-managed-${record.id}`) ||
      root.command.includes(record.signature));
  const owned = new Set(
    rows
      .filter((row) =>
        record.descendants.some((identity) => sameProcess(identity, row)),
      )
      .map((row) => row.pid),
  );
  if (ownsRoot) owned.add(root.pid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (owned.has(row.pid)) continue;
      // Local launches own a detached process group. Include members whose
      // parent already exited, but only while its recorded leader matches.
      if (
        owned.has(row.ppid) ||
        (ownsRoot &&
          record.target.transport === "local" &&
          row.pgid === root.pid)
      ) {
        owned.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => owned.has(row.pid));
}

function validRecord(value: unknown, id: string): value is Record {
  if (!value || typeof value !== "object") return false;
  const record = value as Record;
  const identity = (item: Identity) =>
    item &&
    Number.isSafeInteger(item.pid) &&
    item.pid > 1 &&
    typeof item.started === "string" &&
    item.started.length > 0;
  return (
    record.id === id &&
    /^[0-9a-f-]{36}$/u.test(id) &&
    !!record.target &&
    (record.target.transport === "local" ||
      (record.target.transport === "ssh" &&
        typeof record.target.alias === "string" &&
        /^(?!-)[a-zA-Z0-9._-]{1,253}$/u.test(record.target.alias))) &&
    identity(record.root) &&
    typeof record.signature === "string" &&
    record.signature.length > 0 &&
    Array.isArray(record.descendants) &&
    record.descendants.every(identity)
  );
}

/** The connector's instance lock also owns this ledger; other connectors use separate directories. */
export class ManagedProcesses {
  private readonly active = new Map<
    string,
    { record: Record; process: AgentProcess }
  >();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly retiring = new Set<string>();

  constructor(private readonly directory?: string) {}

  private async save(record: Record): Promise<void> {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${record.id}.json`);
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, file);
  }

  private async remove(record: Record): Promise<void> {
    if (this.directory)
      await rm(path.join(this.directory, `${record.id}.json`), { force: true });
  }

  async reap(target?: HostTarget): Promise<void> {
    if (!this.directory) return;
    const files = await readdir(this.directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const file of files.filter((file) => file.endsWith(".json"))) {
      const id = file.slice(0, -5);
      if (this.active.has(id) && !this.retiring.has(id)) continue;
      try {
        const record: unknown = JSON.parse(
          await readFile(path.join(this.directory, file), "utf8"),
        );
        if (!validRecord(record, id))
          throw new Error("Invalid managed process record");
        if (
          target &&
          (record.target.transport !== target.transport ||
            (record.target.transport === "ssh" &&
              target.transport === "ssh" &&
              record.target.alias !== target.alias))
        )
          continue;
        await this.terminate(record);
      } catch (error) {
        // In particular, retain unreachable SSH hosts for the next connection.
        console.warn(
          `Unable to recover managed process ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async spawn(
    target: HostTarget,
    launch: AgentProcessHostLaunch,
    spawn: ProcessSpawner,
  ): Promise<AgentProcess> {
    await this.reap(target);
    const id = randomUUID();
    const marker = `OVERTCHAT_MANAGED_PID_${id}:`;
    // Do not let the helper start until its PID and start time are on disk.
    // EOF before the acknowledgement exits the gate without launching it.
    const gate = `printf '${marker}%s\\n' "$$" >&2; IFS= read -r ticket || exit 1; [ "$ticket" = '${id}' ] || exit 1; ${buildSshRemoteCommand(launch)}`;
    const child = spawn(target, {
      command: "/bin/sh",
      args: ["-c", gate, `overtchat-managed-${id}`],
      shellMode: "login",
    });
    // A failed SSH session can close stdin between inspection and the gate
    // acknowledgement. The write callback below reports that startup failure.
    child.stdin.on("error", () => {});
    let buffer = "";
    let announced = false;
    let reportPid!: (pid: number) => void;
    const pidPromise = new Promise<number>((resolve) => {
      reportPid = resolve;
    });
    const stderr = new Transform({
      transform(chunk, _encoding, callback) {
        if (announced) {
          callback(null, chunk);
          return;
        }
        buffer += chunk.toString();
        const match = new RegExp(`${marker}(\\d+)\\r?\\n`, "u").exec(buffer);
        if (match) {
          announced = true;
          reportPid(Number(match[1]));
          callback(null, buffer.replace(match[0], ""));
        } else if (buffer.length > 16_384) {
          callback(new Error("Managed process did not announce its PID"));
        } else callback();
      },
    });
    // Keep draining startup noise while the caller is awaiting the gate.
    stderr.on("error", () => {});
    child.stderr.pipe(stderr);
    let timer: NodeJS.Timeout | undefined;
    let record: Record | undefined;
    try {
      const pid = await Promise.race([
        pidPromise,
        child.exit.then(() => {
          throw new Error("Managed process exited before announcing its PID");
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Managed process startup timed out")),
            CONTROL_TIMEOUT_MS,
          );
        }),
      ]);
      const root = (await processTable(target)).find((row) => row.pid === pid);
      if (!root) throw new Error("Managed process exited before registration");
      record = {
        id,
        target,
        root: { pid, started: root.started },
        signature: [path.basename(launch.command), ...(launch.args ?? [])].join(
          " ",
        ),
        descendants: [],
      };
      this.active.set(id, { record, process: child });
      await this.save(record);
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(`${id}\n`, (error) =>
          error ? reject(error) : resolve(),
        );
      });
      const registered = record;
      return { ...child, stderr, terminate: () => this.terminate(registered) };
    } catch (error) {
      child.stdin.end();
      if (record) await this.terminate(record).catch(() => {});
      child.kill("SIGKILL");
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private terminate(record: Record): Promise<void> {
    // Failed cleanup remains eligible for reconciliation even in this daemon,
    // for example when an SSH host comes back before the connector restarts.
    this.retiring.add(record.id);
    const existing = this.stopping.get(record.id);
    if (existing) return existing;
    const stopping = this.stopRecord(record).finally(() =>
      this.stopping.delete(record.id),
    );
    this.stopping.set(record.id, stopping);
    return stopping;
  }

  private async stopRecord(record: Record): Promise<void> {
    let rows = ownedTree(record, await processTable(record.target));
    if (rows.length) {
      // Preserve descendants before signalling the parent: escalation and a
      // subsequent connector restart must still find them after reparenting.
      record.descendants = rows.map(({ pid, started }) => ({ pid, started }));
      await this.save(record);
      await control(
        record.target,
        `kill -TERM ${rows.map((row) => row.pid).join(" ")} 2>/dev/null || true`,
      );
      const deadline = Date.now() + GRACE_MS;
      do {
        await new Promise((resolve) => setTimeout(resolve, 50));
        rows = ownedTree(record, await processTable(record.target));
      } while (rows.length && Date.now() < deadline);
      if (rows.length) {
        await control(
          record.target,
          `kill -KILL ${rows.map((row) => row.pid).join(" ")} 2>/dev/null || true`,
        );
        const forceDeadline = Date.now() + GRACE_MS;
        do {
          await new Promise((resolve) => setTimeout(resolve, 50));
          rows = ownedTree(record, await processTable(record.target));
        } while (rows.length && Date.now() < forceDeadline);
        if (rows.length)
          throw new Error("Managed process tree did not exit after SIGKILL");
      }
    }
    this.active.get(record.id)?.process.kill("SIGTERM");
    this.active.delete(record.id);
    await this.remove(record);
    this.retiring.delete(record.id);
  }

  async stop(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.active.values()].map(({ record }) => this.terminate(record)),
    );
    for (const result of results) {
      if (result.status === "rejected")
        console.warn(
          "Unable to stop managed process; retaining recovery record",
          result.reason,
        );
    }
  }
}
