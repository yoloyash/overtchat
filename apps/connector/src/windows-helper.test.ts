import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentProcessHostLaunch } from "@overtchat/agent-runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  WINDOWS_HELPER_BOOTSTRAP,
  windowsHelperInput,
  windowsInputChannel,
  windowsHelperCommand,
} from "./windows-helper.js";

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* exited */
      }
    } else child.kill("SIGKILL");
  }
});

// Exercise the actual stdin protocol on every CI OS and the Job Object/native
// launcher on Windows. SSH is covered by windows-ssh.integration.
function fixture(
  source: string,
  gate?: string,
  launch?: AgentProcessHostLaunch,
) {
  const child = spawn(
    process.platform === "win32" ? "cmd.exe" : process.execPath,
    process.platform === "win32"
      ? ["/d", "/s", "/c", windowsHelperCommand(process.execPath)]
      : ["-e", WINDOWS_HELPER_BOOTSTRAP],
    {
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);
  const chunks: Buffer[] = [];
  let stderr = "";
  child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stdin.write(
    windowsHelperInput(
      launch ?? { command: "node", args: ["-e", source], shellMode: "login" },
      gate,
    ),
  );
  return {
    child,
    exit,
    output: () => Buffer.concat(chunks),
    stderr: () => stderr,
  };
}

describe("Windows helper channel", () => {
  it("transfers long scripts and binary data while preserving exit status", async () => {
    const f = fixture(
      "/*" +
        "x".repeat(40_000) +
        "*/process.stdin.pipe(process.stdout);process.stdin.on('end',()=>{process.stderr.write('diagnostic');process.exitCode=7})",
    );
    const input = randomBytes(96_000);
    windowsInputChannel(f.child).end(input);
    expect(await f.exit).toBe(7);
    expect(f.output()).toEqual(input);
    expect(f.stderr()).toBe("diagnostic");
  }, 15_000);
  it("allows a server to remain running after logical stdin EOF", async () => {
    const f = fixture(
      "process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>process.stdout.write('after eof'),100))",
    );
    windowsInputChannel(f.child).end();
    expect(await f.exit).toBe(0);
    expect(f.output().toString()).toBe("after eof");
  }, 15_000);
  it("exits on transport EOF even if the child ignores stdin", async () => {
    const f = fixture("setInterval(()=>{},1000)");
    // This protocol-only test does not create a Windows Job Object. On POSIX
    // the descendant still owns stdout until afterEach kills the fixture group.
    const exited = new Promise((resolve) => f.child.once("exit", resolve));
    f.child.stdin.end();
    expect(await exited).toBe(1);
  }, 15_000);
  it("does not launch before the durable ownership gate is acknowledged", async () => {
    const gate = "f57d2e20-38c9-4216-985e-8cd3d1f97ad7";
    const f = fixture("process.stdout.write('started')", gate);
    const channel = windowsInputChannel(f.child, gate);
    await expect
      .poll(f.stderr, { timeout: 10_000 })
      .toContain("OVERTCHAT_MANAGED_PID_");
    expect(f.output().length).toBe(0);
    channel.write(gate + "\n");
    channel.end();
    expect(await f.exit).toBe(0);
    expect(f.output().toString()).toBe("started");
  }, 15_000);

  it.runIf(process.platform === "win32")(
    "round-trips batch-wrapper arguments through cmd.exe",
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "overtchat args & 雪-"),
      );
      try {
        await writeFile(
          path.join(directory, "argv.cjs"),
          "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
        );
        const command = path.join(directory, "echo args.cmd");
        await writeFile(
          command,
          '@echo off\r\n"' + process.execPath + '" "%~dp0argv.cjs" %*\r\n',
        );
        // Real npm installs include all three siblings, not just an explicit
        // .cmd path. Discovery must skip the extensionless POSIX script.
        await writeFile(
          path.join(directory, "echo args"),
          "#!/bin/sh\nexit 99\n",
        );
        await writeFile(path.join(directory, "echo args.ps1"), "exit 99\n");
        const args = [
          "",
          'a & b | "quotes"',
          "%PATH%",
          "!PATH!",
          "雪",
          "C:\\end\\",
          "^()<>;&",
        ];
        for (const executable of [command, "echo args", ".\\echo args.cmd"]) {
          const f = fixture("", undefined, {
            command: executable,
            cwd: directory,
            args,
            shellMode: "login",
            env: { PATH: directory + ";" + process.env.PATH },
          });
          windowsInputChannel(f.child).end();
          expect(await f.exit).toBe(0);
          expect(JSON.parse(f.output().toString())).toEqual(args);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    15_000,
  );
});
