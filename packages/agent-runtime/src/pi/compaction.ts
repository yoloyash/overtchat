import { randomUUID } from "node:crypto";
import type { AgentRuntimeEvent } from "../providers/types";

type CompactionMessage = {
  id: string;
  role: "compactionSummary";
  timestamp: number;
  status: "running" | "completed" | "failed" | "interrupted" | "skipped";
  trigger?: "auto" | "manual";
  tokensBefore?: number;
  tokensAfter?: number;
};

/** Pi/OMP RPC compaction is lifecycle telemetry, not a streamed chat message. */
export class PiCompaction {
  private active: CompactionMessage | undefined;
  private manualPending = false;
  private abortRequested = false;
  private manualEnd: Record<string, unknown> = {};

  constructor(private readonly emit: (event: AgentRuntimeEvent) => void) {}

  private start(trigger?: "auto" | "manual"): void {
    if (this.active) return;
    this.active = {
      id: `compaction:${randomUUID()}`, role: "compactionSummary",
      timestamp: Date.now(), status: "running", ...(trigger ? { trigger } : {}),
    };
    this.emit({ type: "compaction_start", reason: trigger });
    this.emit({ type: "message_end", message: this.active });
  }

  private finish(event: Record<string, unknown>): void {
    if (!this.active) return;
    const result = event.result && typeof event.result === "object"
      ? event.result as Record<string, unknown> : {};
    const message: CompactionMessage = {
      ...this.active,
      status: event.aborted === true ? "interrupted"
        : event.errorMessage || event.error ? "failed"
        : event.skipped === true ? "skipped" : "completed",
    };
    for (const key of ["tokensBefore", "tokensAfter"] as const) {
      const value = result[key] ?? event[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) message[key] = value;
    }
    this.active = undefined;
    this.emit({ type: "message_end", message });
    this.emit({ ...event, type: "compaction_end" });
  }

  handle(event: AgentRuntimeEvent): boolean {
    if (event.type === "auto_compaction_start" || event.type === "compaction_start") {
      this.start(event.type === "auto_compaction_start" ? "auto"
        : event.reason === "manual" ? "manual"
        : event.reason === "auto" ? "auto" : undefined);
      return true;
    }
    if (event.type === "auto_compaction_end" || event.type === "compaction_end") {
      if (this.manualPending) this.manualEnd = event;
      else this.finish(event);
      return true;
    }
    if (event.type === "process_exit" || event.type === "protocol_error") {
      this.finish({ aborted: true });
    }
    return false;
  }

  async manual(request: () => Promise<unknown>): Promise<unknown> {
    if (this.active || this.manualPending) throw new Error("Context compaction is already running.");
    this.manualPending = true;
    this.manualEnd = {};
    this.start("manual");
    try {
      const result = await request();
      this.finish({ ...this.manualEnd, result });
      return result;
    } catch (error) {
      this.finish({ aborted: this.abortRequested, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      this.manualPending = false;
      this.manualEnd = {};
    }
  }

  async abort(request: () => Promise<unknown>): Promise<unknown> {
    this.abortRequested = true;
    try {
      const result = await request();
      this.finish({ aborted: true });
      return result;
    } finally {
      this.abortRequested = false;
    }
  }
}
