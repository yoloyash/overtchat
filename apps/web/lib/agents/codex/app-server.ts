import "server-only";
import type { AgentProcess, HostTarget } from "@/lib/agents/runtime/process";
import { spawnOnHost } from "@/lib/agents/runtime/process";
import {
  JsonlDecoder,
  serializeJsonLine,
} from "@/lib/agents/runtime/jsonl";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const INITIALIZE_TIMEOUT_MS = 60_000;
const MAX_STDERR_CHARS = 64 * 1024;

export type JsonRpcId = string | number;

export type CodexAppServerNotification = {
  method: string;
  params?: unknown;
};

export type CodexAppServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type JsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

function errorText(error: JsonRpcError | undefined, fallback: string): string {
  if (!error) return fallback;
  const detail =
    typeof error.data === "string"
      ? error.data
      : error.data === undefined
        ? ""
        : JSON.stringify(error.data);
  return [error.message || fallback, detail].filter(Boolean).join(" ");
}

export class CodexAppServer {
  private readonly decoder = new JsonlDecoder();
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationSubscribers = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private readonly requestSubscribers = new Set<
    (request: CodexAppServerRequest) => void
  >();
  private nextRequestId = 0;
  private stderr = "";
  private closed = false;
  private readonly initialized: Promise<void>;

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
          `Codex app-server exited (code=${exit.code ?? "unknown"}, signal=${exit.signal ?? "none"}).`,
      );
      this.rejectPending(error);
      this.emitNotification({
        method: "overtchat/processExit",
        params: {
          code: exit.code,
          signal: exit.signal,
          error: error.message,
        },
      });
    });
    this.initialized = this.initialize();
    void this.initialized.catch(() => {});
  }

  onNotification(
    subscriber: (notification: CodexAppServerNotification) => void,
  ): () => void {
    this.notificationSubscribers.add(subscriber);
    return () => this.notificationSubscribers.delete(subscriber);
  }

  onRequest(
    subscriber: (request: CodexAppServerRequest) => void,
  ): () => void {
    this.requestSubscribers.add(subscriber);
    return () => this.requestSubscribers.delete(subscriber);
  }

  async ready(): Promise<void> {
    await this.initialized;
  }

  async request<T = unknown>(
    method: string,
    params: unknown = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    await this.initialized;
    return this.requestNow<T>(method, params, timeoutMs);
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    this.write({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    });
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error("The Codex app-server was stopped."));
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

  getStderr(): string {
    return this.stderr;
  }

  private async initialize(): Promise<void> {
    await this.requestNow(
      "initialize",
      {
        clientInfo: {
          name: "overtchat",
          title: "OvertChat",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
      INITIALIZE_TIMEOUT_MS,
    );
    this.write({ jsonrpc: "2.0", method: "initialized" });
  }

  private requestNow<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error(
        this.stderr.trim() || "The Codex app-server is not running.",
      );
    }
    const id = ++this.nextRequestId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Timed out waiting for Codex ${method}.${this.stderr.trim() ? ` ${this.stderr.trim()}` : ""}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(value: unknown): void {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error("The Codex app-server is not running.");
    }
    this.process.stdin.write(serializeJsonLine(value));
  }

  private handleLine(line: string): void {
    if (!line) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.failProtocol(
        `Codex app-server emitted invalid JSON: ${line.slice(0, 200)}`,
      );
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.failProtocol("Codex app-server emitted a non-object JSON value.");
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      (typeof record.id === "string" ||
        typeof record.id === "number") &&
      ("result" in record || "error" in record) &&
      typeof record.method !== "string"
    ) {
      this.handleResponse(record);
      return;
    }
    if (typeof record.method !== "string") {
      this.failProtocol("Codex app-server frame is missing a method.");
      return;
    }
    if (typeof record.id === "string" || typeof record.id === "number") {
      const request = {
        id: record.id,
        method: record.method,
        ...("params" in record ? { params: record.params } : {}),
      };
      if (this.requestSubscribers.size === 0) {
        this.respondError(record.id, -32601, "Request is not supported.");
        return;
      }
      for (const subscriber of this.requestSubscribers) subscriber(request);
      return;
    }
    this.emitNotification({
      method: record.method,
      ...("params" in record ? { params: record.params } : {}),
    });
  }

  private handleResponse(record: Record<string, unknown>): void {
    const id = record.id as JsonRpcId;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if ("error" in record) {
      const error =
        record.error && typeof record.error === "object"
          ? (record.error as JsonRpcError)
          : undefined;
      pending.reject(
        new Error(errorText(error, `Codex ${pending.method} failed.`)),
      );
      return;
    }
    pending.resolve(record.result);
  }

  private emitNotification(notification: CodexAppServerNotification): void {
    for (const subscriber of this.notificationSubscribers) {
      subscriber(notification);
    }
  }

  private failProtocol(message: string): void {
    const error = new Error(message);
    this.rejectPending(error);
    this.emitNotification({
      method: "overtchat/protocolError",
      params: { error: message },
    });
    this.process.kill("SIGKILL");
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function startCodexAppServer(
  target: HostTarget,
  executable: string,
  cwd?: string,
): CodexAppServer {
  return new CodexAppServer(
    spawnOnHost(target, {
      command: executable,
      args: ["app-server", "--stdio"],
      cwd,
    }),
  );
}
