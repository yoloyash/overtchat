import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  configureProcessSpawner,
  configureHostEnvironmentResolver,
  configureManagedProcessSpawner,
  configureTcpTunnelOpener,
  executeOnHost,
  discoverAgentInstallations,
  listAgentDirectories,
  probeAgentWorkspace,
  workspaceFilesService,
  inspectAgentWorkspaceGitStatus,
} from "@overtchat/agent-runtime";
import { probeOmpTarget } from "@overtchat/agent-runtime/omp/probe";
import { startOmp } from "@overtchat/agent-runtime/omp/client";
import { ConnectorProcessHost } from "./runtime.js";
import { windowsProcessTable } from "./windows-processes.js";
import {
  windowsHelperCommand,
  windowsHelperInput,
  windowsInputChannel,
} from "./windows-helper.js";
import { sshCommandArgs } from "./ssh.js";
import { ConnectorTerminalManager } from "./terminal.js";
import { powershellLiteral } from "./powershell.js";
import type { Terminal } from "@xterm/headless";

const alias = process.env.WINDOWS_SSH_ALIAS;
describe.runIf(Boolean(alias))("native Windows over OpenSSH", () => {
  const target = { transport: "ssh", alias: alias ?? "unused" } as const;
  let host: ConnectorProcessHost;
  let ledger: string;
  let directory: string;
  const run = (source: string, args: string[] = []) =>
    executeOnHost(
      target,
      { command: "node", args: ["-e", source, ...args] },
      { timeoutMs: 30_000 },
    );

  beforeAll(async () => {
    ledger = await mkdtemp(path.join(os.tmpdir(), "overtchat-windows-ledger-"));
    host = new ConnectorProcessHost(ledger);
    configureProcessSpawner(host.spawn);
    configureHostEnvironmentResolver(host.inspectEnvironment);
    configureManagedProcessSpawner(host.spawnManaged);
    configureTcpTunnelOpener(host.openTcpTunnel);
    expect((await host.inspectEnvironment(target)).platform).toBe("win32");
    if (process.env.WINDOWS_SSH_GIT_DIR) {
      const remotePath = (
        await run("process.stdout.write(process.env.PATH || '')")
      ).stdout;
      configureProcessSpawner((target, launch) =>
        host.spawn(target, {
          ...launch,
          env: {
            PATH: process.env.WINDOWS_SSH_GIT_DIR + ";" + remotePath,
            ...launch.env,
          },
        }),
      );
      configureHostEnvironmentResolver(host.inspectEnvironment);
      configureManagedProcessSpawner(host.spawnManaged);
    }
    directory = (
      await run(`
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'overtchat-windows-test-'));
const directory=path.join(root,'spaces & Unicode 雪');fs.mkdirSync(directory);
fs.writeFileSync(path.join(directory,'preview.txt'),'Hello 雪');
const external=path.join(root,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'secret.txt'),'outside');
fs.symlinkSync(external,path.join(directory,'escape'),'junction');
fs.writeFileSync(path.join(directory,'argv.cjs'),'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
fs.writeFileSync(path.join(directory,'echo args.cmd'),'@echo off\\r\\n"'+process.execPath+'" "%~dp0argv.cjs" %*\\r\\n');
fs.writeFileSync(path.join(directory,'echo args'),'#!/bin/sh\\nexit 99\\n');
fs.writeFileSync(path.join(directory,'echo args.ps1'),'exit 99\\n');
process.stdout.write(directory);
`)
    ).stdout;
  }, 60_000);

  afterAll(async () => {
    if (directory)
      await run(
        "require('node:fs').rmSync(require('node:path').dirname(process.argv[1]),{recursive:true,force:true})",
        [directory],
      );
    await host?.stop();
    if (ledger) await rm(ledger, { recursive: true, force: true });
  }, 60_000);

  it("opens a Windows workspace terminal with literal paths, interactive input, resize and reconnect", async () => {
    const cwd = path.win32.join(directory, "terminal's [draft] %PATH%");
    await run("require('node:fs').mkdirSync(process.argv[1])", [cwd]);
    const manager = new ConnectorTerminalManager(undefined, host.inspectEnvironment);
    const workspace = { workspaceId: "terminal", connectionId: "windows", provider: "omp" as const, executable: "omp", target, cwd };
    let output = "";
    const subscribe = (id: string, cols = 100, rows = 30) => manager.subscribe(id, workspace, { cols, rows }, (event) => {
      if (event.type === "output") output = (output + event.data).slice(-64 * 1024);
    });
    const wait = (text: string) => expect.poll(() => output, { timeout: 20_000 }).toContain(text);
    const answerQueries = () => {
      const terminal = (Reflect.get(manager, "terminals") as Map<string, { emulator: Terminal }>).get(workspace.workspaceId)!;
      // A browser renderer answers console device/cursor queries during use.
      terminal.emulator.onData((data) => manager.write(workspace.workspaceId, data));
    };
    try {
      await subscribe("first");
      answerQueries();
      await wait("PS ");
      manager.write(workspace.workspaceId, `if ((Get-Location).Path -ceq ${powershellLiteral(cwd)}) { Write-Output ('CWD:' + 'correct') }; $env:TERMINAL_TEST='retained'\r`);
      await wait("CWD:correct");
      manager.write(workspace.workspaceId, "Write-Output ('UNICODE:' + 'café 日本語 雪')\r");
      await wait("UNICODE:café 日本語 雪");
      manager.unsubscribe("first");
      const snapshot = await subscribe("second", 112, 34);
      expect(snapshot.data).toContain("UNICODE:");
      manager.write(workspace.workspaceId, "Write-Output ('STATE:' + $env:TERMINAL_TEST); Write-Output ('SIZE:' + $Host.UI.RawUI.WindowSize.Width + ':' + $Host.UI.RawUI.WindowSize.Height)\r");
      await wait("STATE:retained");
      await wait("SIZE:112:34");
      manager.write(workspace.workspaceId, "Write-Output ('SLEEP:' + 'started'); Start-Sleep -Seconds 30\r");
      await wait("SLEEP:started");
      output = "";
      manager.write(workspace.workspaceId, "\x03");
      await wait("PS ");
      manager.write(workspace.workspaceId, "Write-Output ('INTERRUPT:' + 'ok')\r");
      await wait("INTERRUPT:ok");
      manager.write(workspace.workspaceId, "Write-Output ('x' * 65536); Write-Output ('BURST:' + 'done')\r");
      await wait("BURST:done");
      manager.unsubscribe("second");
      await manager.restart(workspace, { cols: 100, rows: 30 });
      output = "";
      await subscribe("third");
      answerQueries();
      await wait("PS ");
      manager.write(workspace.workspaceId, "if (-not $env:TERMINAL_TEST) { Write-Output ('RESTART:' + 'clean') }\r");
      await wait("RESTART:clean");
    } finally { manager.stopAll(); }
  }, 120_000);

  it("exits a Windows terminal when its workspace directory is missing", async () => {
    const manager = new ConnectorTerminalManager(undefined, host.inspectEnvironment);
    let exitCode: number | null | undefined;
    let output = "";
    try {
      await manager.subscribe("missing", { workspaceId: "missing", connectionId: "windows", provider: "omp", executable: "omp", target, cwd: path.win32.join(directory, "does-not-exist") }, { cols: 80, rows: 24 }, (event) => {
        if (event.type === "exit") exitCode = event.exitCode;
        else output += event.data;
      });
      const terminal = (Reflect.get(manager, "terminals") as Map<string, { emulator: Terminal }>).get("missing")!;
      terminal.emulator.onData((data) => manager.write("missing", data));
      // Some Windows OpenSSH versions report 0 for every PTY exit. Verify the
      // actionable diagnostic and termination instead of inventing an exit code.
      await expect.poll(() => exitCode, { timeout: 20_000 }).toBeDefined();
      expect(output).toContain("does-not-exist");
      expect(output).not.toContain("PS ");
    } finally { manager.stopAll(); }
  }, 30_000);

  it("browses, validates, and reads a native Windows workspace", async () => {
    const listing = await listAgentDirectories(
      target,
      path.win32.dirname(directory),
    );
    expect(listing.directories).toContainEqual({
      name: path.win32.basename(directory),
      path: directory,
    });
    expect(await probeAgentWorkspace(target, directory)).toEqual({
      name: path.win32.basename(directory),
      path: directory,
    });
    const preview = await workspaceFilesService.readFile(
      target,
      directory,
      "preview.txt",
    );
    expect(preview).toMatchObject({ content: "Hello 雪" });
    await expect(
      workspaceFilesService.readFile(target, directory, "..\\outside.txt"),
    ).rejects.toThrow("outside the workspace");
    await expect(
      workspaceFilesService.readFile(target, directory, "Z:\\outside.txt"),
    ).rejects.toThrow("outside the workspace");
    await expect(
      workspaceFilesService.readFile(target, directory, "escape\\secret.txt"),
    ).rejects.toThrow("outside the workspace");
  }, 60_000);

  it("round-trips executable and npm-wrapper arguments exactly", async () => {
    const args = [
      "",
      'spaces & pipes | "quotes"',
      "%PATH%",
      "!PATH!",
      "雪",
      "C:\\trailing\\",
      "^()<>;&",
    ];
    expect(
      JSON.parse(
        (
          await run(
            "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
            args,
          )
        ).stdout,
      ),
    ).toEqual(args);
    const result = await executeOnHost(target, {
      command: path.win32.join(directory, "echo args.cmd"),
      args,
    });
    expect(JSON.parse(result.stdout)).toEqual(args);
    const byName = await executeOnHost(target, {
      command: "echo args",
      args,
      env: { PATH: directory },
    });
    expect(JSON.parse(byName.stdout)).toEqual(args);
    const relative = await executeOnHost(target, {
      command: ".\\echo args.cmd",
      args,
      cwd: directory,
    });
    expect(JSON.parse(relative.stdout)).toEqual(args);
  }, 60_000);

  it("preserves binary stdin/stdout, stderr, exit status, and scripts above command-line limits", async () => {
    const child = host.spawn(target, {
      command: "node",
      args: [
        "-e",
        "/*" +
          "x".repeat(40_000) +
          "*/process.stdin.pipe(process.stdout);process.stdin.on('end',()=>{process.stderr.write('diagnostic');process.exitCode=7})",
      ],
      shellMode: "login",
    });
    const input = randomBytes(96_000);
    const output: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.stdin.end(input);
    expect((await child.exit).code).toBe(7);
    expect(Buffer.concat(output)).toEqual(input);
    expect(stderr).toBe("diagnostic");
  }, 60_000);

  it("discovers the installed native provider", async () => {
    const installations = await discoverAgentInstallations(target);
    expect(
      installations.some(
        (item) => item.provider === (process.env.WINDOWS_SSH_PROVIDER ?? "omp"),
      ),
    ).toBe(true);
    expect(
      installations.every((item) => /^[A-Z]:\\/i.test(item.executable)),
    ).toBe(true);
  }, 60_000);

  it("keeps a busy agent alive through stdin backpressure and delivers queued EOF", async () => {
    const child = host.spawn(target, {
      command: "node",
      args: [
        "-e",
        "setTimeout(()=>{process.stdin.pipe(process.stdout)},35000)",
      ],
      shellMode: "login",
    });
    const input = randomBytes(1024 * 1024);
    const output: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.end(input);
    expect((await child.exit).code, stderr).toBe(0);
    expect(Buffer.concat(output)).toEqual(input);
  }, 60_000);

  it.runIf(Boolean(process.env.WINDOWS_SSH_GIT_DIR))(
    "reads Git status using native Git for Windows",
    async () => {
      await executeOnHost(target, {
        command: "git",
        args: ["init", "-q", directory],
      });
      const status = await inspectAgentWorkspaceGitStatus(target, directory);
      expect(status).toMatchObject({ isGit: true, dirty: true });
      expect(status.files?.some((file) => file.path === "preview.txt")).toBe(
        true,
      );
    },
    60_000,
  );

  it("opens and cancels a real Oh My Pi RPC session", async () => {
    const installations = await discoverAgentInstallations(target);
    const omp = installations.find((item) => item.provider === "omp");
    expect(omp).toBeDefined();
    const probe = await probeOmpTarget(target, omp!.executable);
    expect(probe.status).toBe("ready");
    const client = startOmp(target, {
      executable: omp!.executable,
      cwd: directory,
      noSession: true,
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules"],
    });
    try {
      expect(await client.getState()).toEqual(expect.any(Object));
      await client.abort();
    } finally {
      await client.stop();
    }
  }, 120_000);

  it.runIf(process.env.WINDOWS_SSH_PROMPT === "1")(
    "streams a real provider response",
    async () => {
      const omp = (await discoverAgentInstallations(target)).find(
        (item) => item.provider === "omp",
      )!;
      const client = startOmp(target, {
        executable: omp.executable,
        cwd: directory,
        noSession: true,
        extraArgs: ["--no-extensions", "--no-skills", "--no-rules"],
      });
      let updates = 0;
      const unsubscribe = client.onEvent((event) => {
        if (event.type === "message_update") updates++;
      });
      try {
        await client.getState();
        await client.prompt(
          "Reply with exactly WINDOWS_SSH_OK. Do not use tools.",
        );
        await expect
          .poll(async () => Boolean((await client.getState()).isStreaming), {
            timeout: 90_000,
          })
          .toBe(false);
        const messages = (await client.getMessages()).messages;
        expect(
          messages.some(
            (message) =>
              message &&
              typeof message === "object" &&
              Reflect.get(message, "role") === "assistant" &&
              JSON.stringify(message).includes("WINDOWS_SSH_OK"),
          ),
        ).toBe(true);
        expect(updates).toBeGreaterThan(0);
      } finally {
        unsubscribe();
        await client.stop();
      }
    },
    120_000,
  );

  it("bootstraps through a PowerShell command parser as well as cmd.exe", async () => {
    const environment = await host.inspectEnvironment(target);
    const command = windowsHelperCommand(environment.node!);
    const child = spawn(
      "ssh",
      sshCommandArgs(
        target.alias,
        `powershell.exe -NoProfile -Command "${command}"`,
      ),
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.stdin.write(
      windowsHelperInput({
        command: "node",
        args: ["-e", "process.stdout.write('PowerShell entry works')"],
        shellMode: "login",
      }),
    );
    windowsInputChannel(child).end();
    const code = await new Promise((resolve) => child.once("close", resolve));
    expect({ code, stderr, stdout }).toEqual({
      code: 0,
      stderr: "",
      stdout: "PowerShell entry works",
    });
  }, 60_000);

  it("closes the Windows job when the SSH transport disappears", async () => {
    const environment = await host.inspectEnvironment(target);
    const child = spawn(
      "ssh",
      sshCommandArgs(target.alias, windowsHelperCommand(environment.node!)),
    );
    child.stderr.resume();
    child.stdin.write(
      windowsHelperInput({
        command: "node",
        args: [
          "-e",
          "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(JSON.stringify([process.pid,process.ppid,c.pid]));setInterval(()=>{},1000)",
        ],
        shellMode: "login",
      }),
    );
    try {
      const pids = await new Promise<number[]>((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          if (output.includes("\n")) resolve(JSON.parse(output.trim()));
        });
        child.on("error", reject);
        child.on("exit", () =>
          reject(new Error("SSH exited before fixture startup")),
        );
      });
      child.kill("SIGKILL");
      await expect
        .poll(
          async () =>
            (await windowsProcessTable(target)).filter((row) =>
              pids.includes(row.pid),
            ),
          { timeout: 15_000, interval: 500 },
        )
        .toEqual([]);
    } finally {
      child.kill("SIGKILL");
    }
  }, 60_000);

  it("cleans up detached descendants after normal parent exit", async () => {
    const result = await run(`
const cp=require('node:child_process');
const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
process.stdout.write(String(child.pid));child.unref();
`);
    const pid = Number(result.stdout);
    expect(pid).toBeGreaterThan(1);
    expect(
      (await windowsProcessTable(target)).some((row) => row.pid === pid),
    ).toBe(false);
  }, 60_000);

  it("recovers an owned process tree from a previous connector ledger", async () => {
    const child = await host.spawnManaged(target, {
      command: "node",
      args: [
        "-e",
        "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)",
      ],
      shellMode: "login",
    });
    child.stdin.end();
    const pids = await new Promise<number[]>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("\n")) resolve(JSON.parse(output.trim()));
      });
      void child.exit.then(() =>
        reject(new Error("Fixture exited before announcing descendants")),
      );
    });
    const recovery = new ConnectorProcessHost(ledger);
    try {
      await recovery.reap();
    } finally {
      await recovery.stop();
    }
    await child.exit;
    expect(
      (await windowsProcessTable(target)).filter((row) =>
        pids.includes(row.pid),
      ),
    ).toEqual([]);
    await expect
      .poll(async () => await readdir(ledger), { timeout: 10_000 })
      .toEqual([]);
  }, 60_000);

  it("expires an abandoned channel even when SSH stdin stays open", async () => {
    const environment = await host.inspectEnvironment(target);
    const child = spawn(
      "ssh",
      sshCommandArgs(target.alias, windowsHelperCommand(environment.node!)),
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.resume();
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    child.stdin.write(
      windowsHelperInput({
        command: "node",
        args: ["-e", "console.log(process.pid);setInterval(()=>{},1000)"],
        shellMode: "login",
      }),
    );
    try {
      // Deliberately omit windowsInputChannel: no heartbeat and no EOF.
      expect(await exit).toBe(1);
      const pid = Number(stdout.trim());
      expect(pid).toBeGreaterThan(1);
      expect(
        (await windowsProcessTable(target)).some((row) => row.pid === pid),
      ).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  }, 45_000);
});
