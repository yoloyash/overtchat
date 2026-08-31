import type { AgentModel, AgentSlashCommand, AgentSessionStats } from "@overtchat/agent-bridge";
import type { AgentSubmissionOptions, ResolvedAgentImage } from "@overtchat/agent-runtime/providers/types";
import { OMP_MODES, ompApprovalMode } from "@overtchat/agent-runtime/omp/config";
import {
  mapOmpUiRequest,
  parseOmpCommands,
  parseOmpModels,
  parseOmpStats,
} from "@overtchat/agent-runtime/omp/protocol";
import {
  JsonlRpcCommandError,
  JsonlRpcTransport,
} from "@overtchat/agent-runtime/runtime/jsonl-rpc";
import { type AgentProcess, type HostTarget, spawnOnHost } from "@overtchat/agent-runtime/runtime/process";

const READY_TIMEOUT_MS = 30_000;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type OmpLaunch = {
  executable: string;
  cwd?: string;
  env?: Record<string, string>;
  sessionPath?: string;
  noSession?: boolean;
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  extraArgs?: string[];
};

type OmpEvent = { type: string; [key: string]: unknown };

export class OmpClient {
  private readonly transport: JsonlRpcTransport;
  private readonly subscribers = new Set<(event: OmpEvent) => void>();
  private readonly ready: Promise<void>;
  private resolveReady: () => void = () => {};
  private rejectReady: (error: Error) => void = () => {};
  private readySettled = false;
  private readyTimer: NodeJS.Timeout | undefined;
  private protocolVersion = 1;
  private chunk: { id: string; count: number; byteLength: number; parts: Buffer[] } | undefined;

  constructor(process: AgentProcess, private readonly modeId: string) {
    this.transport = new JsonlRpcTransport(process, "Oh My Pi");
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      this.readyTimer = setTimeout(
        () => this.failReady(new Error("Timed out waiting for Oh My Pi RPC startup.")),
        READY_TIMEOUT_MS,
      );
      this.readyTimer.unref();
    });
    void this.ready.catch(() => {});
    this.transport.onRecord((record) => this.handleRecord(record));
  }

  onEvent(subscriber: (event: OmpEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private request<T = unknown>(command: OmpEvent, timeoutMs?: number): Promise<T> {
    return this.ready.then(() => this.transport.request(command, timeoutMs));
  }

  async getState(timeoutMs?: number): Promise<Record<string, unknown>> {
    const state = await this.request<Record<string, unknown>>({ type: "get_state" }, timeoutMs);
    const model = state.model;
    const nativeProvider = model && typeof model === "object" ? Reflect.get(model, "provider") : undefined;
    const nativeModelId = model && typeof model === "object" ? Reflect.get(model, "id") : undefined;
    return {
      ...state,
      ...(typeof nativeProvider === "string" && typeof nativeModelId === "string"
        ? { model: { provider: "omp", id: `${nativeProvider}/${nativeModelId}` } }
        : {}),
      modes: OMP_MODES,
      modeId: this.modeId,
    };
  }

  async getAvailableModels(timeoutMs?: number): Promise<AgentModel[]> {
    return parseOmpModels(await this.request({ type: "get_available_models" }, timeoutMs));
  }

  async getSessionStats(): Promise<AgentSessionStats> {
    return parseOmpStats(await this.request({ type: "get_session_stats" }));
  }

  async getCommands(): Promise<AgentSlashCommand[]> {
    return parseOmpCommands(await this.request({ type: "get_available_commands" }));
  }

  async getMessages(): Promise<{ messages: unknown[] }> {
    await this.ready;
    if (this.protocolVersion === 2) {
      try {
        const messages: unknown[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        let total: number | undefined;
        do {
          const page = await this.request<{ messages: unknown[]; totalMessages: number; nextCursor?: string }>({
            type: "get_messages_page",
            ...(cursor ? { cursor } : {}),
            limit: 256,
          });
          if (!Array.isArray(page.messages) || !Number.isSafeInteger(page.totalMessages) || page.totalMessages < 0 || (total !== undefined && total !== page.totalMessages)) {
            throw new Error("Oh My Pi returned inconsistent message pagination.");
          }
          total = page.totalMessages;
          messages.push(...page.messages);
          cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
          if (cursor && seen.has(cursor)) throw new Error("Oh My Pi repeated a message-page cursor.");
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (messages.length !== total) throw new Error("Oh My Pi returned an incomplete message history.");
        return { messages };
      } catch (error) {
        if (!(error instanceof JsonlRpcCommandError) || !["session_busy", "stale_cursor"].includes(error.code ?? "")) throw error;
      }
    }
    return this.request({ type: "get_messages" });
  }

  prompt(message: string, images: readonly ResolvedAgentImage[] = [], _options: AgentSubmissionOptions = {}): Promise<unknown> {
    return this.request({
      type: "prompt",
      message,
      ...(images.length
        ? {
            images: images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mimeType: image.mediaType,
            })),
          }
        : {}),
    });
  }

  steer(message: string, images: readonly ResolvedAgentImage[] = [], _options: AgentSubmissionOptions = {}): Promise<unknown> {
    return this.request({
      type: "steer",
      message,
      ...(images.length
        ? {
            images: images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mimeType: image.mediaType,
            })),
          }
        : {}),
    });
  }

  abort(): Promise<unknown> { return this.request({ type: "abort" }); }

  setModel(modelId: string): Promise<unknown> {
    const separator = modelId.indexOf("/");
    if (separator <= 0 || separator === modelId.length - 1) throw new Error("Oh My Pi model id must include its provider.");
    return this.request({ type: "set_model", provider: modelId.slice(0, separator), modelId: modelId.slice(separator + 1) });
  }

  setThinkingLevel(level: string): Promise<unknown> { return this.request({ type: "set_thinking_level", level }); }

  setMode(modeId: string): Promise<unknown> {
    ompApprovalMode(modeId);
    return Promise.resolve({ type: "warning", message: "Start a new OMP session to change approval mode" });
  }

  compact(customInstructions?: string): Promise<unknown> {
    return this.request({ type: "compact", ...(customInstructions ? { customInstructions } : {}) }, 0x7fffffff);
  }

  setAutoCompaction(enabled: boolean): Promise<unknown> { return this.request({ type: "set_auto_compaction", enabled }); }
  setSessionName(name: string): Promise<unknown> { return this.request({ type: "set_session_name", name }); }

  respondToInteraction(id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }): void {
    this.transport.send({ type: "extension_ui_response", id, ...response });
  }

  async stop(): Promise<void> {
    this.failReady(new Error("The Oh My Pi RPC process was stopped."));
    await this.transport.stop();
  }

  private handleRecord(record: Record<string, unknown>): void {
    if (record.type === "rpc_chunk") { this.handleChunk(record); return; }
    if (this.chunk) { this.transport.fail("Oh My Pi RPC interrupted a chunked response."); return; }
    if (record.type === "ready") { this.handleReady(record); return; }
    if (record.type === "process_exit") {
      this.failReady(new Error(typeof record.error === "string" ? record.error : "Oh My Pi exited."));
    }
    if (record.type === "response" && record.command === "prompt" && record.success === false) {
      this.emit({ type: "rpc_error", command: "prompt", ...(typeof record.id === "string" ? { id: record.id } : {}), error: typeof record.error === "string" ? record.error : "Oh My Pi prompt failed.", ...(typeof record.code === "string" ? { code: record.code } : {}) });
      return;
    }
    if (typeof record.type !== "string") { this.transport.fail("Oh My Pi RPC event is missing a type."); return; }
    this.emit(mapOmpUiRequest(record) as OmpEvent);
  }

  private handleReady(record: Record<string, unknown>): void {
    if (this.readySettled) return;
    const supportsV2 = Array.isArray(record.supportedProtocolVersions) && record.supportedProtocolVersions.includes(2) && record.maxReassembledFrameBytes === MAX_FRAME_BYTES;
    if (!supportsV2) { this.setReady(); return; }
    void this.transport.request({ type: "negotiate_protocol", protocolVersion: 2 }).then((data) => {
      if (!data || typeof data !== "object" || Reflect.get(data, "protocolVersion") !== 2) throw new Error("Oh My Pi RPC protocol v2 negotiation failed.");
      this.protocolVersion = 2;
      this.setReady();
    }).catch((error) => this.failReady(error instanceof Error ? error : new Error(String(error))));
  }

  private handleChunk(record: Record<string, unknown>): void {
    if (this.protocolVersion !== 2 || typeof record.chunkId !== "string" || !Number.isSafeInteger(record.index) || !Number.isSafeInteger(record.count) || !Number.isSafeInteger(record.byteLength) || typeof record.data !== "string") {
      this.transport.fail("Oh My Pi RPC emitted an invalid chunk."); return;
    }
    const index = Number(record.index); const count = Number(record.count); const byteLength = Number(record.byteLength);
    if (index < 0 || count < 1 || index >= count || byteLength < 0 || byteLength > MAX_FRAME_BYTES) { this.transport.fail("Oh My Pi RPC emitted invalid chunk bounds."); return; }
    if (!this.chunk) {
      if (index !== 0) { this.transport.fail("Oh My Pi RPC chunk sequence started late."); return; }
      this.chunk = { id: record.chunkId, count, byteLength, parts: [] };
    }
    if (this.chunk.id !== record.chunkId || this.chunk.count !== count || this.chunk.byteLength !== byteLength || this.chunk.parts.length !== index) { this.transport.fail("Oh My Pi RPC emitted an invalid chunk sequence."); return; }
    this.chunk.parts.push(Buffer.from(record.data, "base64"));
    if (this.chunk.parts.length !== count) return;
    const chunk = this.chunk; this.chunk = undefined;
    const bytes = Buffer.concat(chunk.parts);
    if (bytes.byteLength !== chunk.byteLength) { this.transport.fail("Oh My Pi RPC chunk length did not match."); return; }
    try {
      const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
      this.transport.accept(decoded as Record<string, unknown>);
    } catch { this.transport.fail("Oh My Pi RPC chunk contained invalid JSON."); }
  }

  private setReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.resolveReady();
  }

  private failReady(error: Error): void {
    if (this.readySettled) return;
    this.readySettled = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.rejectReady(error);
  }

  private emit(event: OmpEvent): void { for (const subscriber of this.subscribers) subscriber(event); }
}

export function buildOmpArgs(launch: OmpLaunch): string[] {
  const modeId = launch.modeId ?? "full";
  const args = ["--mode", "rpc-ui", "--approval-mode", ompApprovalMode(modeId)];
  if (launch.extraArgs) args.push(...launch.extraArgs);
  if (launch.model) args.push("--model", launch.model);
  if (launch.thinkingOptionId) args.push("--thinking", launch.thinkingOptionId);
  if (launch.noSession) args.push("--no-session");
  if (launch.sessionPath) args.push("--session", launch.sessionPath);
  return args;
}

export function startOmp(target: HostTarget, launch: OmpLaunch): OmpClient {
  const modeId = launch.modeId ?? "full";
  const args = buildOmpArgs(launch);
  return new OmpClient(spawnOnHost(target, { command: launch.executable, args, cwd: launch.cwd, env: launch.env }), modeId);
}
