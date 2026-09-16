import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectorProcessHost } from "./runtime.js";
import { parseProcessTable } from "./managed-processes.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-processes-"),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const host = new ConnectorProcessHost(directory);
  cleanups.push(() => host.stop());
  return { host, directory };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("managed helper processes", () => {
  it("parses Linux and macOS process identities and excludes zombies", () => {
    expect(
      parseProcessTable(
        [
          " 100 1 100 Ssl Tue Sep 15 11:05:37 2026 /usr/bin/opencode serve",
          " 101 100 100 Z Tue Sep 15 11:05:37 2026 [sleep] <defunct>",
          " 200 1 200 S Mon Sep  7 09:00:00 2026 /opt/homebrew/bin/opencode serve",
        ].join("\n"),
      ),
    ).toMatchObject([
      { pid: 100, ppid: 1, pgid: 100, started: "Tue Sep 15 11:05:37 2026" },
      { pid: 200, started: "Mon Sep 7 09:00:00 2026" },
    ]);
  });

  it("records ownership before starting and reaps a previous host's helper", async () => {
    const { host, directory } = await fixture();
    const child = await host.spawnManaged(
      { transport: "local" },
      {
        command: "/bin/sleep",
        args: ["60"],
        shellMode: "login",
      },
    );
    child.stdin.end();
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const record = JSON.parse(
      await readFile(path.join(directory, files[0]), "utf8"),
    );
    expect(alive(record.root.pid)).toBe(true);
    await host.reap();
    expect(alive(record.root.pid)).toBe(true);
    expect(await readdir(directory)).toHaveLength(1);
    await new ConnectorProcessHost(directory).reap();
    await child.exit;
    expect(alive(record.root.pid)).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(["started", "signature"])(
    "does not kill a PID whose %s no longer matches",
    async (field) => {
      const { host, directory } = await fixture();
      const child = await host.spawnManaged(
        { transport: "local" },
        {
          command: "/bin/sleep",
          args: ["60"],
          shellMode: "login",
        },
      );
      child.stdin.end();
      // Wait for exec to replace the startup gate (which has its own identity).
      await new Promise((resolve) => setTimeout(resolve, 100));
      const [file] = await readdir(directory);
      const location = path.join(directory, file);
      const record = JSON.parse(await readFile(location, "utf8"));
      if (field === "started") record.root.started = "a different start time";
      else record.signature = "a different command";
      await writeFile(location, JSON.stringify(record));
      await new ConnectorProcessHost(directory).reap();
      expect(alive(record.root.pid)).toBe(true);
      expect(await readdir(directory)).toEqual([]);
      await child.terminate?.();
    },
  );

  it.each(["managed", "ordinary"])(
    "cleans up a surviving descendant of a %s process",
    async (kind) => {
      const { host, directory } = await fixture();
      const source = [
        'const {spawn}=require("node:child_process");',
        'const child=spawn(process.execPath,["-e",\'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)\'],{stdio:["ignore","pipe","ignore"]});',
        'child.stdout.once("data",()=>console.log(child.pid));',
        "setInterval(()=>{},1000);",
      ].join("");
      const child = await (kind === "managed" ? host.spawnManaged : host.spawn)(
        { transport: "local" },
        {
          command: process.execPath,
          args: ["-e", source],
          shellMode: "login",
        },
      );
      child.stdin.end();
      const pid = await new Promise<number>((resolve) =>
        child.stdout.once("data", (data) =>
          resolve(Number(data.toString().trim())),
        ),
      );
      cleanups.push(async () => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Successful cleanup may already have reaped the fixture process.
        }
      });
      if (kind === "managed") await child.terminate?.();
      else await host.stop();
      // A reparented zombie may briefly remain visible to kill(0).
      const status = await promisify(execFile)("ps", [
        "-p",
        String(pid),
        "-o",
        "stat=",
      ])
        .then(({ stdout }) => stdout.trim())
        .catch(() => "");
      expect(status === "" || status.startsWith("Z")).toBe(true);
      expect(await readdir(directory)).toEqual([]);
    },
  );
});
