import type { AgentProcess, HostTarget } from "@overtchat/agent-runtime/runtime/process";
import { spawnOnHost } from "@overtchat/agent-runtime/runtime/process";
import {
  JsonlDecoder,
  serializeJsonLine,
} from "@overtchat/agent-runtime/runtime/jsonl";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const INITIALIZE_TIMEOUT_MS = 60_000;
const MAX_STDERR_CHARS = 64 * 1024;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 1_000;
const FORCE_SHUTDOWN_TIMEOUT_MS = 1_000;

type CodexAppServerOptions = {
  enableGoals?: boolean;
};

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

function spawnCodexAppServer(
  target: HostTarget,
  executable: string,
  cwd?: string,
  options: CodexAppServerOptions = {},
): AgentProcess {
  return spawnOnHost(target, {
    command: executable,
    args: [
      "app-server",
      ...(options.enableGoals ? ["--enable", "goals"] : []),
      "--stdio",
    ],
    cwd,
  });
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
  private stopping = false;
  private terminationHandled = false;
  private readonly initialized: Promise<void>;

  constructor(private readonly process: AgentProcess) {
    process.stdin.on("error", (error) => {
      if (this.stopping) return;
      this.handleUnexpectedTermination(error, null, null);
      process.kill("SIGKILL");
    });
    process.stdout.on("data", (chunk) => {
      for (const line of this.decoder.push(chunk)) this.handleLine(line);
    });
    process.stdout.on("end", () => {
      for (const line of this.decoder.end()) this.handleLine(line);
    });
    process.stdout.on("error", (error) => {
      if (this.stopping) return;
      this.handleUnexpectedTermination(error, null, null);
      process.kill("SIGKILL");
    });
    process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(
        -MAX_STDERR_CHARS,
      );
    });
    process.stderr.on("error", (error) => {
      if (this.stopping) return;
      this.handleUnexpectedTermination(error, null, null);
      process.kill("SIGKILL");
    });
    void process.exit.then((exit) => {
      const detail = exit.error?.message ?? this.stderr.trim();
      this.handleUnexpectedTermination(
        new Error(
          detail ||
            `Codex app-server exited (code=${exit.code ?? "unknown"}, signal=${exit.signal ?? "none"}).`,
        ),
        exit.code,
        exit.signal,
      );
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
    this.stopping = true;
    this.closed = true;
    this.rejectPending(new Error("The Codex app-server was stopped."));
    try {
      this.process.stdin.end();
    } catch {
      // The process may already have closed its input while we were stopping.
    }
    this.process.kill("SIGTERM");
    if (await this.waitForExit(GRACEFUL_SHUTDOWN_TIMEOUT_MS)) return;
    this.process.kill("SIGKILL");
    await this.waitForExit(FORCE_SHUTDOWN_TIMEOUT_MS);
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
      for (const subscriber of this.requestSubscribers) {
        try {
          subscriber(request);
        } catch (error) {
          try {
            this.respondError(
              record.id,
              -32603,
              error instanceof Error ? error.message : "Request handler failed.",
            );
          } catch {
            // The process may have exited while the handler was running.
          }
          return;
        }
      }
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
      try {
        subscriber(notification);
      } catch {
        // A consumer failure must not escape the provider process boundary.
      }
    }
  }

  private handleUnexpectedTermination(
    error: Error,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.terminationHandled) return;
    this.terminationHandled = true;
    this.closed = true;
    if (this.stopping) return;
    this.rejectPending(error);
    this.emitNotification({
      method: "overtchat/processExit",
      params: { code, signal, error: error.message },
    });
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.process.exit.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
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

export async function startCodexAppServer(
  target: HostTarget,
  executable: string,
  cwd?: string,
  options: CodexAppServerOptions = {},
): Promise<CodexAppServer> {
  const server = new CodexAppServer(
    spawnCodexAppServer(target, executable, cwd, options),
  );
  try {
    await server.ready();
    return server;
  } catch (error) {
    await server.stop().catch(() => {});
    throw error;
  }
}
