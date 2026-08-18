import type { AgentProcess } from "@overtchat/agent-runtime/runtime/process";
import {
  JsonlDecoder,
  serializeJsonLine,
} from "@overtchat/agent-runtime/runtime/jsonl";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_STDERR_CHARS = 64 * 1024;

type RpcFrame = { type: string; [key: string]: unknown };

type PendingRequest = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class JsonlRpcCommandError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "JsonlRpcCommandError";
  }
}

export class JsonlRpcTransport {
  private readonly decoder = new JsonlDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<(record: Record<string, unknown>) => void>();
  private requestNumber = 0;
  private stderr = "";
  private stderrPosition = 0;
  private stderrBufferStart = 0;
  private closed = false;

  constructor(
    private readonly process: AgentProcess,
    private readonly label: string,
  ) {
    process.stdout.on("data", (chunk) => {
      for (const line of this.decoder.push(chunk)) this.handleLine(line);
    });
    process.stdout.on("end", () => {
      for (const line of this.decoder.end()) this.handleLine(line);
    });
    process.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.stderrPosition += text.length;
      this.stderr = `${this.stderr}${text}`.slice(-MAX_STDERR_CHARS);
      this.stderrBufferStart = this.stderrPosition - this.stderr.length;
    });
    void process.exit.then((exit) => {
      this.closed = true;
      const detail = exit.error?.message ?? this.stderr.trim();
      const error = new Error(
        detail ||
          `${this.label} RPC exited (code=${exit.code ?? "unknown"}, signal=${exit.signal ?? "none"}).`,
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

  onRecord(subscriber: (record: Record<string, unknown>) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  request<T = unknown>(
    command: RpcFrame,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error(
        this.stderr.trim() || `The ${this.label} RPC process is not running.`,
      );
    }
    const id = `req_${++this.requestNumber}`;
    const stderrStart = this.stderrPosition;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const stderr = this.stderrSince(stderrStart).trim();
        reject(
          new Error(
            `Timed out waiting for ${this.label} ${command.type}.${stderr ? ` ${stderr}` : ""}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        command: command.type,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.process.stdin.write(serializeJsonLine({ ...command, id }), (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  send(frame: RpcFrame): void {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error(`The ${this.label} RPC process is not running.`);
    }
    this.process.stdin.write(serializeJsonLine(frame));
  }

  accept(record: Record<string, unknown>): void {
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
            `${this.label} RPC response mismatch: expected ${pending.command}, received ${String(record.command)}.`,
          ),
        );
      } else if (record.success === true) {
        pending.resolve(record.data);
      } else {
        pending.reject(
          new JsonlRpcCommandError(
            typeof record.error === "string"
              ? record.error
              : `${this.label} ${pending.command} failed.`,
            typeof record.code === "string" ? record.code : undefined,
          ),
        );
      }
      return;
    }
    this.emit(record);
  }

  fail(message: string): void {
    const error = new Error(message);
    this.rejectPending(error);
    this.emit({ type: "protocol_error", error: message });
    this.process.kill("SIGKILL");
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error(`The ${this.label} RPC process was stopped.`));
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
      this.fail(`${this.label} RPC emitted invalid JSON: ${line.slice(0, 200)}`);
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.fail(`${this.label} RPC emitted a non-object JSON value.`);
      return;
    }
    this.accept(message as Record<string, unknown>);
  }

  private stderrSince(position: number): string {
    return this.stderr.slice(Math.max(0, position - this.stderrBufferStart));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emit(record: Record<string, unknown>): void {
    for (const subscriber of this.subscribers) subscriber(record);
  }
}
