import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export type HostTarget =
  | { transport: "local" }
  | {
      transport: "ssh";
      hostname: string;
      port: number;
      username: string;
      hostKey: string;
      privateKey?: string;
    };

export type AgentProcessLaunch = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type AgentProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

export type AgentProcess = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exit: Promise<AgentProcessExit>;
  kill(signal?: NodeJS.Signals): boolean;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function remoteCommand(launch: AgentProcessLaunch): string {
  const env = Object.entries(launch.env ?? {})
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const command = [launch.command, ...(launch.args ?? [])]
    .map(shellQuote)
    .join(" ");
  const invocation = `${env ? `${env} ` : ""}exec ${command}`;
  return launch.cwd
    ? `cd -- ${shellQuote(launch.cwd)} && ${invocation}`
    : invocation;
}

function sshHostFiles(target: Extract<HostTarget, { transport: "ssh" }>): {
  directory: string;
  knownHostsPath: string;
  identityPath?: string;
} {
  const directory = mkdtempSync(path.join(tmpdir(), "overtchat-agent-"));
  const knownHostsPath = path.join(directory, "known_hosts");
  writeFileSync(knownHostsPath, `${target.hostKey.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (!target.privateKey) return { directory, knownHostsPath };
  const identityPath = path.join(directory, "identity");
  writeFileSync(identityPath, `${target.privateKey.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { directory, knownHostsPath, identityPath };
}

function wrapProcess(
  child: ChildProcessWithoutNullStreams,
  cleanup?: () => void,
): AgentProcess {
  let settled = false;
  let settle: (exit: AgentProcessExit) => void = () => {};
  const exit = new Promise<AgentProcessExit>((resolve) => {
    settle = resolve;
  });
  const finish = (result: AgentProcessExit) => {
    if (settled) return;
    settled = true;
    cleanup?.();
    settle(result);
  };
  child.once("error", (error) =>
    finish({ code: null, signal: null, error }),
  );
  child.once("exit", (code, signal) => finish({ code, signal }));
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exit,
    kill: (signal = "SIGTERM") => child.kill(signal),
  };
}

export function spawnOnHost(
  target: HostTarget,
  launch: AgentProcessLaunch,
): AgentProcess {
  if (target.transport === "local") {
    return wrapProcess(
      spawn(launch.command, launch.args ?? [], {
        cwd: launch.cwd,
        env: { ...process.env, ...launch.env },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  }

  const files = sshHostFiles(target);
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${files.knownHostsPath}`,
    "-p",
    String(target.port),
  ];
  if (files.identityPath) {
    args.push("-o", "IdentitiesOnly=yes", "-i", files.identityPath);
  }
  args.push(
    `${target.username}@${target.hostname}`,
    remoteCommand(launch),
  );
  return wrapProcess(
    spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] }),
    () => rmSync(files.directory, { recursive: true, force: true }),
  );
}

export async function executeOnHost(
  target: HostTarget,
  launch: AgentProcessLaunch,
  options: { timeoutMs?: number; stdin?: string } = {},
): Promise<CommandResult> {
  const processHandle = spawnOnHost(target, launch);
  let stdout = "";
  let stderr = "";
  let capturedBytes = 0;
  let captureError: Error | null = null;

  const append = (current: string, chunk: Buffer | string): string => {
    const text = chunk.toString();
    capturedBytes += Buffer.byteLength(text);
    if (capturedBytes > MAX_CAPTURE_BYTES) {
      captureError = new Error("Agent command produced too much output.");
      processHandle.kill("SIGKILL");
      return current;
    }
    return current + text;
  };
  processHandle.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
  });
  processHandle.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
  });

  if (options.stdin !== undefined) processHandle.stdin.end(options.stdin);
  else processHandle.stdin.end();

  const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const timeout = setTimeout(() => processHandle.kill("SIGKILL"), timeoutMs);
  const exit = await processHandle.exit;
  clearTimeout(timeout);

  if (captureError) throw captureError;
  const stderrText = stderr.trim();
  if (exit.error) {
    throw new Error(`Unable to start agent command: ${exit.error.message}`);
  }
  if (exit.code !== 0) {
    throw new Error(
      stderrText ||
        `Agent command exited with code ${exit.code ?? "unknown"}.`,
    );
  }
  return {
    stdout,
    stderr,
  };
}
