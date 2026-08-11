import { Writable, type Readable } from "node:stream";
import type { ConnectorShellMode } from "@overtchat/agent-bridge";

export type HostTarget =
  | { transport: "local"; shellMode?: ConnectorShellMode }
  | { transport: "ssh"; alias: string; shellMode?: ConnectorShellMode };

export type AgentProcessLaunch = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type AgentProcessHostLaunch = AgentProcessLaunch & {
  shellMode: ConnectorShellMode;
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

export type CommandResult = { stdout: string; stderr: string };

export type ProcessSpawner = (
  target: HostTarget,
  launch: AgentProcessHostLaunch,
) => AgentProcess;

let configuredSpawner: ProcessSpawner | undefined;

export function configureProcessSpawner(spawner: ProcessSpawner): void {
  configuredSpawner = spawner;
}

export function spawnOnHost(
  target: HostTarget,
  launch: AgentProcessLaunch,
): AgentProcess {
  if (!configuredSpawner) {
    throw new Error("The agent process spawner has not been configured.");
  }
  return configuredSpawner(target, {
    ...launch,
    shellMode: target.shellMode ?? "interactive",
  });
}

const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

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

  let timeout: NodeJS.Timeout | undefined;
  let exit: AgentProcessExit;
  try {
    exit = await Promise.race([
      processHandle.exit,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          processHandle.kill("SIGKILL");
          reject(
            new Error(
              `Agent command timed out after ${options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS} milliseconds.`,
            ),
          );
        }, options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (captureError) throw captureError;
  if (exit.error) throw new Error(`Unable to start agent command: ${exit.error.message}`);
  if (exit.code !== 0) {
    throw new Error(
      stderr.trim() || `Agent command exited with code ${exit.code ?? "unknown"}.`,
    );
  }
  return { stdout, stderr };
}
