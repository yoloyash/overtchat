import "server-only";
import type { Readable, Writable } from "node:stream";
import type {
  ConnectorProcessLaunch,
  ConnectorShellMode,
  ConnectorTarget,
} from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";

const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export type HostTarget =
  | {
      connectorId: string;
      transport: "local";
      shellMode?: ConnectorShellMode;
    }
  | {
      connectorId: string;
      transport: "ssh";
      alias: string;
      shellMode?: ConnectorShellMode;
    };

export type AgentProcessLaunch = Omit<
  ConnectorProcessLaunch,
  "shellMode"
>;

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

export function spawnOnHost(
  target: HostTarget,
  launch: AgentProcessLaunch,
): AgentProcess {
  const connectorTarget: ConnectorTarget =
    target.transport === "local"
      ? { transport: "local" }
      : { transport: "ssh", alias: target.alias };
  return hostConnectorBroker.spawn(
    target.connectorId,
    connectorTarget,
    {
      ...launch,
      shellMode: target.shellMode ?? "interactive",
    },
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
  let timeout: NodeJS.Timeout | undefined;
  let exit: AgentProcessExit;
  try {
    exit = await Promise.race([
      processHandle.exit,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          processHandle.kill("SIGKILL");
          reject(
            new Error(`Agent command timed out after ${timeoutMs} milliseconds.`),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

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
