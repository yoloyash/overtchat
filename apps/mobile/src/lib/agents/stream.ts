import {
  applyEnvelopeToReplica,
  applyLegacyEnvelopeToReplica,
  applySyncToReplica,
  formatAgentRuntimeCursor,
  isAgentRuntimeEnvelope,
  isAgentSessionSync,
  replicaFromOpenResult,
  type AgentSessionReplica,
  type AgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";

export class AgentHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// SSE is a line protocol: network chunks may split UTF-8, CRLF, or JSON anywhere.
export function createEventParser(
  onEvent: (event: string, data: string) => void,
) {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  return (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.search(/[\r\n]/u)) >= 0) {
      if (buffer[end] === "\r" && end === buffer.length - 1) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(
        end + (buffer.slice(end, end + 2) === "\r\n" ? 2 : 1),
      );
      if (line === "") {
        if (data.length) onEvent(event, data.join("\n"));
        event = "message";
        data = [];
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /u, "");
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
    }
  };
}

export type StreamStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "paused"
  | "error";
type Options = {
  id: string;
  request: (path: string, signal: AbortSignal) => Promise<Response>;
  initial?: AgentSessionReplica;
  onReplica: (replica: AgentSessionReplica) => void;
  onStatus: (status: StreamStatus, error?: string) => void;
};

/** One foreground subscription. All retries reconcile before subscribing again. */
export class AgentSessionStream {
  private replica?: AgentSessionReplica;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private attempt = 0;
  private active = false;

  constructor(private readonly options: Options) {
    this.replica = options.initial;
  }

  start() {
    this.active = true;
    this.reconnect();
  }

  stop() {
    this.active = false;
    this.generation++;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.options.onStatus("paused");
  }

  reconnect() {
    if (!this.active) return;
    this.controller?.abort();
    clearTimeout(this.timer);
    const generation = ++this.generation;
    void this.connect(generation);
  }

  private async connect(generation: number) {
    const controller = new AbortController();
    this.controller = controller;
    const current = () => this.active && generation === this.generation;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(watchdog);
      // The server emits a heartbeat every 15s. Recover half-open connections.
      watchdog = setTimeout(() => controller.abort(), 60_000);
    };
    const commit = (replica: AgentSessionReplica) => {
      if (!current()) return;
      this.replica = replica;
      this.options.onReplica(replica);
    };
    this.options.onStatus(this.replica ? "reconnecting" : "connecting");
    touch();
    try {
      const base = `/api/agent-sessions/${encodeURIComponent(this.options.id)}`;
      const after = this.replica?.cursor
        ? `?after=${encodeURIComponent(formatAgentRuntimeCursor(this.replica.cursor))}`
        : "";
      const response = await this.options.request(
        base + after,
        controller.signal,
      );
      const data = (await response.json()) as {
        snapshot: AgentRuntimeSnapshot;
        sync?: unknown;
      };
      if (!current()) return;
      if (
        data.snapshot?.sessionId !== this.options.id ||
        (data.sync !== undefined && !isAgentSessionSync(data.sync))
      ) {
        throw new Error("The server returned an invalid agent session.");
      }
      commit(
        replicaFromOpenResult(
          {
            snapshot: data.snapshot,
            ...(isAgentSessionSync(data.sync) ? { sync: data.sync } : {}),
          },
          this.replica,
        ),
      );
      const params = new URLSearchParams({ sync: "1" });
      if (this.replica?.cursor)
        params.set("after", formatAgentRuntimeCursor(this.replica.cursor));
      const stream = await this.options.request(
        `${base}/events?${params}`,
        controller.signal,
      );
      if (!current()) return;
      if (
        !stream.body ||
        !stream.headers.get("content-type")?.includes("text/event-stream")
      ) {
        throw new Error("The server did not return an agent event stream.");
      }
      this.options.onStatus("connected");
      const parse = createEventParser((event, text) => {
        if (!current()) return;
        if (!["sync", "runtime", "legacy-runtime"].includes(event)) return;
        const value: unknown = JSON.parse(text);
        if (event === "sync" && isAgentSessionSync(value)) {
          const next = applySyncToReplica(this.replica, value);
          if (!next) throw new Error("Agent session needs to resynchronize.");
          commit(next);
        } else if (
          event !== "sync" &&
          isAgentRuntimeEnvelope(value) &&
          this.replica
        ) {
          const update =
            event === "legacy-runtime"
              ? applyLegacyEnvelopeToReplica(this.replica, value)
              : applyEnvelopeToReplica(this.replica, value);
          if (update.type === "reconcile")
            throw new Error("Agent session needs to resynchronize.");
          if (update.type === "applied") commit(update.replica);
        } else {
          throw new Error("The server returned an invalid agent event.");
        }
        this.attempt = 0;
      });
      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (current()) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          parse(decoder.decode(value, { stream: true }));
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (current()) throw new Error("Agent connection closed. Reconnecting…");
    } catch (error) {
      if (!current()) return;
      const message =
        error instanceof Error ? error.message : "Agent connection failed.";
      if (
        error instanceof AgentHttpError &&
        [401, 403, 404].includes(error.status)
      ) {
        this.options.onStatus("error", message);
        return;
      }
      this.options.onStatus("reconnecting", message);
      this.timer = setTimeout(
        () => this.reconnect(),
        Math.min(1000 * 2 ** this.attempt++, 30_000),
      );
    } finally {
      clearTimeout(watchdog);
      controller.abort();
    }
  }
}
