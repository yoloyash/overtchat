import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ConnectorTarget,
} from "@overtchat/agent-bridge";
import type {
  AgentProcess,
  AgentProcessHostLaunch,
  HostTarget,
} from "@overtchat/agent-runtime";
import { buildSshRemoteCommand, sshSpawnArgs } from "./ssh.js";

function killProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): boolean {
  if (child.exitCode !== null || child.signalCode !== null) return false;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Fall back to the direct child when its process group is already gone.
    }
  }
  return child.kill(signal);
}

function targetForSpawn(target: HostTarget): ConnectorTarget {
  return target.transport === "local"
    ? { transport: "local" }
    : { transport: "ssh", alias: target.alias };
}

export class ConnectorProcessHost {
  private readonly processes = new Set<ChildProcessWithoutNullStreams>();

  spawn = (
    target: HostTarget,
    launch: AgentProcessHostLaunch,
  ): AgentProcess => {
    const connectorTarget = targetForSpawn(target);
    const child =
      connectorTarget.transport === "local"
        ? spawn("/bin/sh", ["-c", buildSshRemoteCommand(launch)], {
            env: process.env,
            detached: process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
          })
        : spawn("ssh", sshSpawnArgs(connectorTarget.alias, launch), {
            detached: process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
          });
    this.processes.add(child);
    child.once("exit", () => this.processes.delete(child));
    child.once("error", () => this.processes.delete(child));

    let settled = false;
    let settle: (value: Awaited<AgentProcess["exit"]>) => void = () => {};
    const exit = new Promise<Awaited<AgentProcess["exit"]>>((resolve) => {
      settle = resolve;
    });
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      settle({ code, signal, ...(error ? { error } : {}) });
    };
    child.once("error", (error) => finish(null, null, error));
    child.once("exit", (code, signal) => finish(code, signal));

    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exit,
      kill: (signal = "SIGTERM") => killProcessTree(child, signal),
    };
  };

  stop(): void {
    for (const child of this.processes) {
      if (!killProcessTree(child, "SIGTERM")) continue;
      const timer = setTimeout(() => killProcessTree(child, "SIGKILL"), 1_000);
      timer.unref();
      child.once("exit", () => clearTimeout(timer));
    }
  }
}
