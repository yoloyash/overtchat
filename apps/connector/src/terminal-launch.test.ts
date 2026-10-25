import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentDaemonWorkspaceDescriptor } from "@overtchat/agent-bridge";
import type { ExecutionEnvironment, HostEnvironments } from "./host-environment.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("./terminal-process.js", () => ({ terminalProcessSupport: () => {}, spawnTerminal: mocks.spawn }));
import { ConnectorTerminalManager } from "./terminal.js";

const workspace: AgentDaemonWorkspaceDescriptor = {
  workspaceId: "windows", connectionId: "connection", provider: "omp", executable: "omp",
  target: { transport: "ssh", alias: "windows" }, cwd: "C:\\project",
};
const managers: ConnectorTerminalManager[] = [];
beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation(() => ({
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
  }));
});
afterEach(() => { for (const manager of managers.splice(0)) manager.stopAll(); });

function fixture() {
  let resolve!: (environment: ExecutionEnvironment) => void;
  const inspected = new Promise<ExecutionEnvironment>((done) => { resolve = done; });
  const inspect = vi.fn<HostEnvironments["inspect"]>(() => inspected);
  const manager = new ConnectorTerminalManager(undefined, inspect);
  managers.push(manager);
  const subscribe = (id = "view", descriptor = workspace) => manager.subscribe(id, descriptor, { cols: 80, rows: 24 }, () => {});
  return { manager, inspect, resolve, subscribe };
}

it("shares one platform probe and one Windows shell across concurrent viewers", async () => {
  const f = fixture();
  const first = f.subscribe("first");
  const second = f.subscribe("second");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(f.inspect).toHaveBeenCalledOnce();
  f.resolve({ platform: "win32" });
  await Promise.all([first, second]);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(mocks.spawn.mock.calls[0][0]).toBe("ssh");
  expect(mocks.spawn.mock.calls[0][1].at(-1)).toContain("powershell.exe -NoLogo -NoExit");
});

it.each(["workspace", "connection", "all", "kill"] as const)("cancels a pending probe when stopping %s and never launches its shell afterward", async (scope) => {
  const f = fixture();
  const result = expect(f.subscribe()).rejects.toThrow();
  const signal = f.inspect.mock.calls[0][1]!;
  if (scope === "workspace") f.manager.stopWorkspace(workspace.workspaceId);
  if (scope === "connection") f.manager.stopConnection(workspace.connectionId);
  if (scope === "all") f.manager.stopAll();
  if (scope === "kill") expect(f.manager.kill(workspace.workspaceId)).toBe(true);
  expect(signal.aborted).toBe(true);
  // Even a probe that ignores cancellation cannot start a process afterward.
  f.resolve({ platform: "win32" });
  await result;
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("does not share an in-flight shell with a different owner", async () => {
  const f = fixture();
  const first = f.subscribe();
  await expect(f.subscribe("other", { ...workspace, connectionId: "other" })).rejects.toThrow("different workspace");
  f.resolve({ platform: "posix" });
  await first;
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(mocks.spawn.mock.calls[0][1].at(-1)).toContain('exec "${SHELL:-/bin/sh}" -il');
});

it("reserves capacity during remote probes", async () => {
  const f = fixture();
  const starts = Array.from({ length: 32 }, (_, i) => f.subscribe(`view-${i}`, { ...workspace, workspaceId: `workspace-${i}` }));
  const results = Promise.allSettled(starts);
  await expect(f.subscribe("overflow")).rejects.toThrow("Close an existing workspace terminal");
  f.manager.stopAll();
  f.resolve({ platform: "win32" });
  expect((await results).every((result) => result.status === "rejected")).toBe(true);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("opens local Windows terminals in PowerShell 7 when installed, else Windows PowerShell", async () => {
  const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const directory = await mkdtemp(path.join(os.tmpdir(), "terminal-shell-"));
  try {
    vi.stubEnv("SystemRoot", "C:\\Windows");
    vi.stubEnv("Path", directory);
    const local = { ...workspace, workspaceId: "local", target: { transport: "local" as const } };
    await fixture().subscribe("local", local);
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      path.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoLogo"], expect.objectContaining({ cwd: "C:\\project" }));
    await writeFile(path.join(directory, "pwsh.exe"), "");
    await fixture().subscribe("local", local);
    expect(mocks.spawn).toHaveBeenLastCalledWith(path.join(directory, "pwsh.exe"), ["-NoLogo"], expect.anything());
  } finally {
    platform.mockRestore();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it("launches SSH terminals from a Windows connector through the resolved ssh.exe", async () => {
  const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const directory = await mkdtemp(path.join(os.tmpdir(), "terminal-ssh-"));
  try {
    vi.stubEnv("Path", directory);
    // ConPTY does not apply PATHEXT, so a bare "ssh" fails with "File not found".
    const missing = fixture();
    const rejected = expect(missing.subscribe()).rejects.toThrow("Windows OpenSSH client (ssh.exe)");
    missing.resolve({ platform: "posix" });
    await rejected;
    expect(mocks.spawn).not.toHaveBeenCalled();
    await writeFile(path.join(directory, "ssh.exe"), "");
    const found = fixture();
    const opened = found.subscribe();
    found.resolve({ platform: "posix" });
    await opened;
    expect(mocks.spawn.mock.calls[0][0]).toBe(path.join(directory, "ssh.exe"));
  } finally {
    platform.mockRestore();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
