import { EventEmitter } from "node:events";
import type {
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import {
  spawnOnHost,
  type AgentProcess,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const REMOTE_ENV_ALLOWLIST = new Set([
  "CLAUDE_AGENT_SDK_CLIENT_APP",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "NO_COLOR",
  "TERM",
]);

function hostEnvironment(
  target: HostTarget,
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => {
      if (typeof value !== "string") return [];
      if (target.transport === "ssh" && !REMOTE_ENV_ALLOWLIST.has(key)) {
        return [];
      }
      return [[key, value]];
    }),
  );
}

export class ClaudeHostProcess
  extends EventEmitter
  implements SpawnedProcess
{
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  readonly stdin: AgentProcess["stdin"];
  readonly stdout: AgentProcess["stdout"];

  constructor(private readonly process: AgentProcess) {
    super();
    this.stdin = process.stdin;
    this.stdout = process.stdout;
    void process.exit.then(({ code, signal, error }) => {
      this.exitCode = code;
      this.signalCode = signal;
      if (error) this.emit("error", error);
      this.emit("exit", code, signal);
    });
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killed = true;
    return this.process.kill(signal);
  }
}

export function spawnClaudeOnHost(
  target: HostTarget,
  options: SpawnOptions,
  onStderr: (data: string) => void,
): SpawnedProcess {
  const process = spawnOnHost(target, {
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    env: hostEnvironment(target, options.env),
  });
  process.stderr.on("data", (chunk) => onStderr(chunk.toString()));
  const spawned = new ClaudeHostProcess(process);
  if (options.signal.aborted) spawned.kill("SIGTERM");
  else {
    options.signal.addEventListener(
      "abort",
      () => spawned.kill("SIGTERM"),
      { once: true },
    );
  }
  return spawned;
}
