import "server-only";
import type {
  AgentModel,
  AgentSlashCommand,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import {
  type AgentProcess,
  type HostTarget,
  spawnOnHost,
} from "@/lib/agents/runtime/process";
import {
  JsonlDecoder,
  serializeJsonLine,
} from "@/lib/agents/runtime/jsonl";
import {
  parsePiCommands,
  parsePiModels,
  parsePiSessionStats,
  parsePiThinkingLevels,
  type PiRpcCommand,
  type PiRpcEvent,
} from "@/lib/agents/pi/protocol";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_STDERR_CHARS = 64 * 1024;

type PendingRequest = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type PiRpcLaunch = {
  executable: string;
  cwd?: string;
  env?: Record<string, string>;
  sessionPath?: string;
  noSession?: boolean;
  extraArgs?: string[];
};

export class PiRpcClient {
  private readonly decoder = new JsonlDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<(event: PiRpcEvent) => void>();
  private requestNumber = 0;
  private stderr = "";
  private closed = false;

  constructor(private readonly process: AgentProcess) {
    process.stdout.on("data", (chunk) => {
      for (const line of this.decoder.push(chunk)) this.handleLine(line);
    });
    process.stdout.on("end", () => {
      for (const line of this.decoder.end()) this.handleLine(line);
    });
    process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(
        -MAX_STDERR_CHARS,
      );
    });
    void process.exit.then((exit) => {
      this.closed = true;
      const detail = exit.error?.message ?? this.stderr.trim();
      const error = new Error(
        detail ||
          `Pi RPC exited (code=${exit.code ?? "unknown"}, signal=${exit.signal ?? "none"}).`,
      );
      this.rejectPending(error);
      this.emit({
        type: "process_exit",
        code: exit.code,
        signal: exit.signal,
        error: error.message,
      });
    });
  }

  getStderr(): string {
    return this.stderr;
  }

  onEvent(subscriber: (event: PiRpcEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async request<T = unknown>(
    command: PiRpcCommand,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error(
        this.stderr.trim() || "The Pi RPC process is not running.",
      );
    }
    const id = `req_${++this.requestNumber}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Timed out waiting for Pi ${command.type}.${this.stderr ? ` ${this.stderr.trim()}` : ""}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        command: command.type,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.process.stdin.write(
        serializeJsonLine({ ...command, id }),
        (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          reject(error);
        },
      );
    });
  }

  send(frame: PiRpcCommand): void {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error("The Pi RPC process is not running.");
    }
    this.process.stdin.write(serializeJsonLine(frame));
  }

  getState(): Promise<Record<string, unknown>> {
    return this.request({ type: "get_state" });
  }

  async getAvailableModels(timeoutMs?: number): Promise<AgentModel[]> {
    const data = await this.request(
      { type: "get_available_models" },
      timeoutMs,
    );
    return parsePiModels(data);
  }

  async getSessionStats(): Promise<AgentSessionStats> {
    return parsePiSessionStats(
      await this.request({ type: "get_session_stats" }),
    );
  }

  async getAvailableThinkingLevels(): Promise<AgentThinkingLevel[]> {
    return parsePiThinkingLevels(
      await this.request({ type: "get_available_thinking_levels" }),
    );
  }

  async getCommands(): Promise<AgentSlashCommand[]> {
    return parsePiCommands(await this.request({ type: "get_commands" }));
  }

  getMessages(): Promise<{ messages: unknown[] }> {
    return this.request({ type: "get_messages" });
  }

  prompt(
    message: string,
    streamingBehavior?: "steer" | "followUp",
  ): Promise<unknown> {
    return this.request({
      type: "prompt",
      message,
      ...(streamingBehavior ? { streamingBehavior } : {}),
    });
  }

  abort(): Promise<unknown> {
    return this.request({ type: "abort" });
  }

  setModel(provider: string, modelId: string): Promise<unknown> {
    return this.request({ type: "set_model", provider, modelId });
  }

  setThinkingLevel(level: string): Promise<unknown> {
    return this.request({ type: "set_thinking_level", level });
  }

  compact(customInstructions?: string): Promise<unknown> {
    return this.request(
      {
        type: "compact",
        ...(customInstructions ? { customInstructions } : {}),
      },
      0x7fffffff,
    );
  }

  setSessionName(name: string): Promise<unknown> {
    return this.request({ type: "set_session_name", name });
  }

  respondToExtensionUi(
    id: string,
    response: {
      value?: string;
      confirmed?: boolean;
      cancelled?: boolean;
    },
  ): void {
    this.send({ type: "extension_ui_response", id, ...response });
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error("The Pi RPC process was stopped."));
    this.process.stdin.end();
    this.process.kill("SIGTERM");
    let forceKillTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.process.exit,
      new Promise<void>((resolve) => {
        forceKillTimer = setTimeout(() => {
          this.process.kill("SIGKILL");
          resolve();
        }, 1_000);
      }),
    ]);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }

  private handleLine(line: string): void {
    if (!line) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.failProtocol(`Pi RPC emitted invalid JSON: ${line.slice(0, 200)}`);
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.failProtocol("Pi RPC emitted a non-object JSON value.");
      return;
    }
    const record = message as Record<string, unknown>;
    if (
      record.type === "response" &&
      typeof record.id === "string" &&
      this.pending.has(record.id)
    ) {
      const pending = this.pending.get(record.id)!;
      clearTimeout(pending.timeout);
      this.pending.delete(record.id);
      if (record.command !== pending.command) {
        pending.reject(
          new Error(
            `Pi RPC response mismatch: expected ${pending.command}, received ${String(record.command)}.`,
          ),
        );
      } else if (record.success === true) {
        pending.resolve(record.data);
      } else {
        pending.reject(
          new Error(
            typeof record.error === "string"
              ? record.error
              : `Pi ${pending.command} failed.`,
          ),
        );
      }
      return;
    }
    if (typeof record.type !== "string") {
      this.failProtocol("Pi RPC event is missing a type.");
      return;
    }
    this.emit(record as PiRpcEvent);
  }

  private failProtocol(message: string): void {
    const error = new Error(message);
    this.rejectPending(error);
    this.emit({ type: "protocol_error", error: message });
    this.process.kill("SIGKILL");
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emit(event: PiRpcEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

export function startPiRpc(
  target: HostTarget,
  launch: PiRpcLaunch,
): PiRpcClient {
  const args = ["--mode", "rpc"];
  if (launch.noSession) args.push("--no-session");
  if (launch.sessionPath) args.push("--session", launch.sessionPath);
  if (launch.extraArgs) args.push(...launch.extraArgs);
  return new PiRpcClient(
    spawnOnHost(target, {
      command: launch.executable,
      args,
      cwd: launch.cwd,
      env: launch.env,
    }),
  );
}
