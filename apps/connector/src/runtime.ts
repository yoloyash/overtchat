import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import type {
  ConnectorTarget,
} from "@overtchat/agent-bridge";
import type {
  AgentProcess,
  AgentProcessHostLaunch,
  AgentTcpTunnel,
  HostTarget,
} from "@overtchat/agent-runtime";
import { buildSshRemoteCommand, sshSpawnArgs, sshTunnelArgs } from "./ssh.js";

const TUNNEL_START_TIMEOUT_MS = 10_000;

function availableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Unable to allocate a loopback port."));
        else resolve(port);
      });
    });
  });
}

function waitForLoopbackPort(
  port: number,
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  const deadline = Date.now() + TUNNEL_START_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", exited);
      if (error) reject(error);
      else resolve();
    };
    const exited = (code: number | null) =>
      finish(
        new Error(
          stderr.trim() ||
            `SSH TCP tunnel exited before it became ready (code ${code ?? "unknown"}).`,
        ),
      );
    child.once("exit", exited);
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8_192) stderr += chunk.toString();
    });
    const attempt = () => {
      if (settled) return;
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.unref();
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          finish(new Error("Timed out waiting for the SSH TCP tunnel."));
          return;
        }
        setTimeout(attempt, 50).unref();
      });
    };
    attempt();
  });
}

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

  openTcpTunnel = async (
    target: Extract<HostTarget, { transport: "ssh" }>,
    remotePort: number,
  ): Promise<AgentTcpTunnel> => {
    const localPort = await availableLoopbackPort();
    const child = spawn("ssh", sshTunnelArgs(target.alias, localPort, remotePort), {
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.processes.add(child);
    child.once("exit", () => this.processes.delete(child));
    child.once("error", () => this.processes.delete(child));
    try {
      await waitForLoopbackPort(localPort, child);
    } catch (error) {
      killProcessTree(child, "SIGTERM");
      throw error;
    }
    let closePromise: Promise<void> | null = null;
    return {
      url: `http://127.0.0.1:${localPort}`,
      close: () => {
        if (closePromise) return closePromise;
        closePromise = new Promise((resolve) => {
          if (!killProcessTree(child, "SIGTERM")) {
            resolve();
            return;
          }
          const timer = setTimeout(() => killProcessTree(child, "SIGKILL"), 1_000);
          timer.unref();
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return closePromise;
      },
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
