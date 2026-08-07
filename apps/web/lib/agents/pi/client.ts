import "server-only";
import type {
  AgentModel,
  AgentProviderId,
  AgentSlashCommand,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import { AGENT_THINKING_LEVELS } from "@/lib/agents/types";
import { agentProviderMetadata } from "@/lib/agents/catalog";
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
import { mergeAgentSlashCommands } from "@/lib/agents/pi/commands";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_STDERR_CHARS = 64 * 1024;
const OMP_MAX_REASSEMBLED_FRAME_BYTES = 64 * 1024 * 1024;

type PendingRequest = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type PiRpcLaunch = {
  provider?: AgentProviderId;
  executable: string;
  cwd?: string;
  env?: Record<string, string>;
  sessionPath?: string;
  noSession?: boolean;
  extraArgs?: string[];
};

class RpcCommandError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RpcCommandError";
  }
}

export class PiRpcClient {
  private readonly decoder = new JsonlDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<(event: PiRpcEvent) => void>();
  private requestNumber = 0;
  private stderr = "";
  private closed = false;
  private protocolVersion = 1;
  private readonly ready: Promise<void>;
  private resolveReady: () => void = () => {};
  private rejectReady: (error: Error) => void = () => {};
  private readySettled = false;
  private readyTimer: NodeJS.Timeout | undefined;
  private chunk:
    | {
        id: string;
        count: number;
        byteLength: number;
        parts: Buffer[];
      }
    | undefined;

  constructor(
    private readonly process: AgentProcess,
    readonly provider: AgentProviderId = "pi",
  ) {
    this.ready =
      provider === "omp"
        ? new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
            this.readyTimer = setTimeout(() => {
              this.settleReady(
                new Error("Timed out waiting for Oh My Pi RPC startup."),
              );
            }, DEFAULT_REQUEST_TIMEOUT_MS);
            this.readyTimer.unref();
          })
        : Promise.resolve();
    void this.ready.catch(() => {});
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
          `${this.label} RPC exited (code=${exit.code ?? "unknown"}, signal=${exit.signal ?? "none"}).`,
      );
      this.settleReady(error);
      this.rejectPending(error);
      this.emit({
        type: "process_exit",
        code: exit.code,
        signal: exit.signal,
        error: error.message,
      });
    });
  }

  private get label(): string {
    return agentProviderMetadata(this.provider).label;
  }

  getStderr(): string {
    return this.stderr;
  }

  onEvent(subscriber: (event: PiRpcEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  request<T = unknown>(
    command: PiRpcCommand,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    return this.provider === "pi"
      ? this.requestNow(command, timeoutMs)
      : this.ready.then(() => this.requestNow(command, timeoutMs));
  }

  private requestNow<T = unknown>(
    command: PiRpcCommand,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error(
        this.stderr.trim() || `The ${this.label} RPC process is not running.`,
      );
    }
    const id = `req_${++this.requestNumber}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Timed out waiting for ${this.label} ${command.type}.${this.stderr ? ` ${this.stderr.trim()}` : ""}`,
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
      throw new Error(`The ${this.label} RPC process is not running.`);
    }
    this.process.stdin.write(serializeJsonLine(frame));
  }

  getState(timeoutMs?: number): Promise<Record<string, unknown>> {
    return this.request({ type: "get_state" }, timeoutMs);
  }

  async getAvailableModels(timeoutMs?: number): Promise<AgentModel[]> {
    const data = await this.request(
      { type: "get_available_models" },
      timeoutMs,
    );
    return parsePiModels(data, this.provider);
  }

  async getSessionStats(): Promise<AgentSessionStats> {
    return parsePiSessionStats(
      await this.request({ type: "get_session_stats" }),
    );
  }

  async getAvailableThinkingLevels(): Promise<AgentThinkingLevel[]> {
    if (this.provider === "omp") return [...AGENT_THINKING_LEVELS];
    return parsePiThinkingLevels(
      await this.request({ type: "get_available_thinking_levels" }),
    );
  }

  async getCommands(): Promise<AgentSlashCommand[]> {
    return mergeAgentSlashCommands(
      this.provider,
      parsePiCommands(
        await this.request({
          type:
            this.provider === "omp"
              ? "get_available_commands"
              : "get_commands",
        }),
      ),
    );
  }

  async getMessages(): Promise<{ messages: unknown[] }> {
    await this.ready;
    if (this.provider === "omp" && this.protocolVersion === 2) {
      try {
        const messages: unknown[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        let totalMessages: number | undefined;
        do {
          const page = await this.request<{
            messages: unknown[];
            totalMessages: number;
            nextCursor?: string;
          }>({
            type: "get_messages_page",
            ...(cursor ? { cursor } : {}),
            limit: 256,
          });
          if (
            !Array.isArray(page.messages) ||
            !Number.isSafeInteger(page.totalMessages) ||
            page.totalMessages < 0 ||
            (totalMessages !== undefined &&
              page.totalMessages !== totalMessages)
          ) {
            throw new Error(
              "Oh My Pi returned inconsistent message pagination.",
            );
          }
          totalMessages = page.totalMessages;
          messages.push(...page.messages);
          cursor =
            typeof page.nextCursor === "string"
              ? page.nextCursor
              : undefined;
          if (cursor && seenCursors.has(cursor)) {
            throw new Error("Oh My Pi repeated a message-page cursor.");
          }
          if (cursor) seenCursors.add(cursor);
        } while (cursor);
        if (messages.length !== totalMessages) {
          throw new Error("Oh My Pi returned an incomplete message history.");
        }
        return { messages };
      } catch (error) {
        if (
          !(error instanceof RpcCommandError) ||
          !["session_busy", "stale_cursor"].includes(error.code ?? "")
        ) {
          throw error;
        }
      }
    }
    return this.request({ type: "get_messages" });
  }

  prompt(message: string): Promise<unknown> {
    return this.request({
      type: "prompt",
      message,
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

  setAutoCompaction(enabled: boolean): Promise<unknown> {
    return this.request({ type: "set_auto_compaction", enabled });
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
    const error = new Error(`The ${this.label} RPC process was stopped.`);
    this.settleReady(error);
    this.rejectPending(error);
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
      this.failProtocol(
        `${this.label} RPC emitted invalid JSON: ${line.slice(0, 200)}`,
      );
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.failProtocol(`${this.label} RPC emitted a non-object JSON value.`);
      return;
    }
    this.handleRecord(message as Record<string, unknown>);
  }

  private handleRecord(record: Record<string, unknown>): void {
    if (record.type === "rpc_chunk") {
      this.handleChunk(record);
      return;
    }
    if (this.chunk) {
      this.failProtocol(
        `${this.label} RPC interrupted a chunked response.`,
      );
      return;
    }
    if (record.type === "ready") {
      this.handleReady(record);
      return;
    }
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
          new RpcCommandError(
            typeof record.error === "string"
              ? record.error
              : `${this.label} ${pending.command} failed.`,
            typeof record.code === "string" ? record.code : undefined,
          ),
        );
      }
      return;
    }
    if (
      this.provider === "omp" &&
      record.type === "response" &&
      record.command === "prompt" &&
      record.success === false
    ) {
      this.emit({
        type: "rpc_error",
        command: "prompt",
        ...(typeof record.id === "string" ? { id: record.id } : {}),
        error:
          typeof record.error === "string"
            ? record.error
            : "Oh My Pi prompt failed.",
        ...(typeof record.code === "string" ? { code: record.code } : {}),
      });
      return;
    }
    if (typeof record.type !== "string") {
      this.failProtocol(`${this.label} RPC event is missing a type.`);
      return;
    }
    this.emit(record as PiRpcEvent);
  }

  private handleReady(record: Record<string, unknown>): void {
    if (this.provider !== "omp" || this.readySettled) return;
    const supportsV2 =
      Array.isArray(record.supportedProtocolVersions) &&
      record.supportedProtocolVersions.includes(2) &&
      record.maxReassembledFrameBytes === OMP_MAX_REASSEMBLED_FRAME_BYTES;
    if (!supportsV2) {
      this.readySettled = true;
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.resolveReady();
      return;
    }
    void this.requestNow({
      type: "negotiate_protocol",
      protocolVersion: 2,
    })
      .then((data) => {
        const version =
          data && typeof data === "object"
            ? Reflect.get(data, "protocolVersion")
            : undefined;
        if (version !== 2) {
          throw new Error("Oh My Pi RPC protocol v2 negotiation failed.");
        }
        this.protocolVersion = 2;
        this.readySettled = true;
        if (this.readyTimer) clearTimeout(this.readyTimer);
        this.resolveReady();
      })
      .catch((error) =>
        this.settleReady(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
  }

  private handleChunk(record: Record<string, unknown>): void {
    if (
      this.protocolVersion !== 2 ||
      typeof record.chunkId !== "string" ||
      !Number.isSafeInteger(record.index) ||
      !Number.isSafeInteger(record.count) ||
      !Number.isSafeInteger(record.byteLength) ||
      typeof record.data !== "string"
    ) {
      this.failProtocol(`${this.label} RPC emitted an invalid chunk.`);
      return;
    }
    const index = record.index as number;
    const count = record.count as number;
    const byteLength = record.byteLength as number;
    if (
      index < 0 ||
      count < 1 ||
      index >= count ||
      byteLength < 0 ||
      byteLength > OMP_MAX_REASSEMBLED_FRAME_BYTES
    ) {
      this.failProtocol(`${this.label} RPC emitted invalid chunk bounds.`);
      return;
    }
    if (!this.chunk) {
      if (index !== 0) {
        this.failProtocol(`${this.label} RPC chunk sequence started late.`);
        return;
      }
      this.chunk = {
        id: record.chunkId,
        count,
        byteLength,
        parts: [],
      };
    }
    if (
      this.chunk.id !== record.chunkId ||
      this.chunk.count !== count ||
      this.chunk.byteLength !== byteLength ||
      this.chunk.parts.length !== index
    ) {
      this.failProtocol(`${this.label} RPC emitted an invalid chunk sequence.`);
      return;
    }
    this.chunk.parts.push(Buffer.from(record.data, "base64"));
    if (this.chunk.parts.length !== count) return;

    const chunk = this.chunk;
    this.chunk = undefined;
    const bytes = Buffer.concat(chunk.parts);
    if (bytes.byteLength !== chunk.byteLength) {
      this.failProtocol(`${this.label} RPC chunk length did not match.`);
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      this.failProtocol(`${this.label} RPC chunk contained invalid JSON.`);
      return;
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      this.failProtocol(
        `${this.label} RPC chunk decoded to a non-object value.`,
      );
      return;
    }
    this.handleRecord(decoded as Record<string, unknown>);
  }

  private failProtocol(message: string): void {
    const error = new Error(message);
    this.settleReady(error);
    this.rejectPending(error);
    this.emit({ type: "protocol_error", error: message });
    this.process.kill("SIGKILL");
  }

  private settleReady(error: Error): void {
    if (this.provider !== "omp" || this.readySettled) return;
    this.readySettled = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.rejectReady(error);
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
  const provider = launch.provider ?? "pi";
  const args = ["--mode", "rpc"];
  if (launch.noSession) args.push("--no-session");
  if (launch.sessionPath) {
    args.push(
      provider === "omp" ? "--resume" : "--session",
      launch.sessionPath,
    );
  }
  if (launch.extraArgs) args.push(...launch.extraArgs);
  return new PiRpcClient(
    spawnOnHost(target, {
      command: launch.executable,
      args,
      cwd: launch.cwd,
      env: launch.env,
    }),
    provider,
  );
}
