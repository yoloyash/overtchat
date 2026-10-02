import { createHash } from "node:crypto";
import { boundedEventBatch } from "./event-batch.js";
import {
  HOST_CONNECTOR_EVENT_BATCH_BYTES,
  HOST_CONNECTOR_FRAGMENT_BYTES,
  HOST_CONNECTOR_MAX_EVENT_BYTES,
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorCommand,
  MAX_AGENT_IMAGE_BYTES,
  type AgentPromptImage,
  type HostConnectorEventAck,
  type HostConnectorEventBatch,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import type { ResolvedAgentImage } from "@overtchat/agent-runtime";
import {
  connectorLockPath,
  connectorStatePath,
  connectorTimelinePath,
  type ConnectorConfig,
} from "./config.js";
import { ConnectorDaemon } from "./daemon.js";
import { ConnectorProcessHost } from "./runtime.js";
import { ConnectorInstanceLock } from "./lock.js";
import { ConnectorStateJournal } from "./state.js";
import { ConnectorTimelineStore } from "./timeline.js";
import { CONNECTOR_VERSION } from "./version.js";
import {
  ConnectorCommandScheduler,
  isConnectorCommandBarrier,
} from "./command-scheduler.js";

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const EVENT_BATCH_DELAY_MS = 25;
const MAX_BUFFERED_LIVE_EVENTS = 2_048;

type LiveEventPayload = Extract<
  HostConnectorEventPayload,
  { type: "session_event" }
>;

type LiveEventBatch = {
  payloads: LiveEventPayload[];
  hints: Array<[string, LiveEventPayload]>;
  queued: LiveEventPayload[];
};

function endpoint(serverUrl: string, path: string): string {
  return `${serverUrl}${path}`;
}

function reconnectDelay(attempt: number): number {
  const cap = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 30),
    RECONNECT_MAX_DELAY_MS,
  );
  return Math.round(cap * (0.5 + Math.random() * 0.5));
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export class ConnectorClient {
  private readonly daemon: ConnectorDaemon;
  private readonly commandScheduler: ConnectorCommandScheduler;
  private readonly stopAbort = new AbortController();
  private commandStreamAbort: AbortController | undefined;
  private eventRequestAbort: AbortController | undefined;
  private flushTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private eventRetryAttempt = 0;
  private flushing = false;
  private preferLiveEvents = false;
  private stopped = false;
  private acceptingDurableEvents = true;
  private stopPromise: Promise<void> | undefined;
  private terminalError: Error | undefined;
  private liveEventEpoch = crypto.randomUUID();
  private liveEventSequence = 0;
  private readonly liveEvents: LiveEventPayload[] = [];
  /**
   * The high-volume event queue is deliberately bounded, but dropping its
   * oldest entry outright could leave a quiet session stale forever. Keep the
   * newest displaced envelope for every subscription as a reconciliation
   * marker. Once delivered it either fills the next sequence or makes the
   * browser detect a gap and request the authoritative connector timeline.
   */
  private readonly liveOverflowHints = new Map<string, LiveEventPayload>();

  private constructor(
    private readonly config: ConnectorConfig,
    private readonly journal: ConnectorStateJournal,
    private readonly timelines: ConnectorTimelineStore,
    private readonly lock: ConnectorInstanceLock,
    processHost: ConnectorProcessHost,
  ) {
    this.daemon = new ConnectorDaemon(
      (event) => this.enqueue(event),
      (images) => this.resolveImages(images),
      journal,
      timelines,
      (error) => this.fail(error),
      undefined,
      processHost,
    );
    this.commandScheduler = new ConnectorCommandScheduler((command) =>
      this.daemon.handle(command),
    );
  }

  static async create(config: ConnectorConfig): Promise<ConnectorClient> {
    const lock = await ConnectorInstanceLock.acquire(
      connectorLockPath(config.connectorId),
    );
    let journal: ConnectorStateJournal | undefined;
    let timelines: ConnectorTimelineStore | undefined;
    try {
      const processHost = new ConnectorProcessHost(
        `${connectorStatePath(config.connectorId)}.processes`,
      );
      journal = await ConnectorStateJournal.open(
        connectorStatePath(config.connectorId),
      );
      timelines = await ConnectorTimelineStore.open(
        connectorTimelinePath(config.connectorId),
      );
      const client = new ConnectorClient(config, journal, timelines, lock, processHost);
      // Remote cleanup must not delay the authenticated channel. Per-target launches
      // still await recovery, and shutdown cancels recovery before releasing the lock.
      processHost.startRecovery();
      return client;
    } catch (error) {
      await timelines?.close().catch(() => {});
      await journal?.close().catch(() => {});
      await lock.release();
      throw error;
    }
  }

  async run(): Promise<void> {
    void this.flush();
    while (!this.stopped && !this.terminalError) {
      try {
        await this.openCommandStream();
      } catch (error) {
        if (this.stopped) break;
        if (this.terminalError) throw this.terminalError;
        console.error(
          `Connector stream disconnected: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      await waitForRetry(
        reconnectDelay(this.reconnectAttempt++),
        this.stopAbort.signal,
      );
    }
    if (this.terminalError) throw this.terminalError;
  }

  private fail(error: Error): void {
    if (this.terminalError || this.stopped) return;
    this.terminalError = error;
    this.stopAbort.abort();
    this.commandStreamAbort?.abort();
    this.eventRequestAbort?.abort();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    this.stopPromise = (async () => {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
      this.stopAbort.abort();
      this.commandStreamAbort?.abort();
      this.eventRequestAbort?.abort();
      let failure: unknown;
      for (const close of [
        async () => {
          this.commandScheduler.close();
          await this.commandScheduler.drain();
        },
        () => this.daemon.stop(),
        // Requests already accepted by the daemon may finish while stop is
        // draining them. Their responses are durable protocol events, so
        // force those journal writes to disk before closing either store.
        () => this.journal.flush(),
        () => {
          this.acceptingDurableEvents = false;
          return Promise.resolve();
        },
        () => this.timelines.close(),
        () => this.journal.close(),
        () => this.lock.release(),
      ]) {
        try {
          await close();
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure) throw failure;
    })();
    return this.stopPromise;
  }

  private async openCommandStream(): Promise<void> {
    const abort = new AbortController();
    this.commandStreamAbort = abort;
    const response = await fetch(
      endpoint(this.config.serverUrl, "/api/host-connectors/channel"),
      {
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "X-OvertChat-Connector-Build-Version": CONNECTOR_VERSION,
          "X-OvertChat-Connector-Capabilities":
            HOST_CONNECTOR_CAPABILITIES.join(","),
          "X-OvertChat-Connector-Protocol": String(
            HOST_CONNECTOR_PROTOCOL_VERSION,
          ),
        },
      },
    );
    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        detail?.error ?? `OvertChat returned HTTP ${response.status}.`,
      );
    }
    this.reconnectAttempt = 0;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffered = "";
    try {
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line) {
            const command: unknown = JSON.parse(line);
            if (!isHostConnectorCommand(command)) {
              throw new Error("OvertChat sent an invalid connector command.");
            }
            if (command.type === "sync") {
              await this.commandScheduler.drain();
              await this.daemon.handle(command);
            } else if (isConnectorCommandBarrier(command)) {
              await this.commandScheduler.drain();
              await this.daemon.handle(command);
            } else {
              this.commandScheduler.enqueue(command);
            }
          }
          newline = buffered.indexOf("\n");
        }
      }
    } finally {
      if (this.commandStreamAbort === abort) {
        this.commandStreamAbort = undefined;
      }
    }
  }

  private enqueue(payload: HostConnectorEventPayload): void {
    if (payload.type === "session_event") {
      if (this.stopped) return;
      // The per-session timeline is already synced to disk before the daemon
      // emits this live hint. Keeping a second durable copy here caused stale
      // connectors to accumulate hundreds of megabytes. A lost/bounded hint is
      // recovered through the authoritative session sync.
      this.liveEvents.push(payload);
      if (this.liveEvents.length > MAX_BUFFERED_LIVE_EVENTS) {
        const displaced = this.liveEvents.splice(
          0,
          this.liveEvents.length - MAX_BUFFERED_LIVE_EVENTS,
        );
        for (const hint of displaced) {
          this.liveOverflowHints.set(hint.subscriptionId, hint);
        }
      }
    } else {
      if (!this.acceptingDurableEvents) return;
      this.journal.enqueue(payload);
    }
    // Stopping disables transport delivery, but the stop sequence above will
    // persist any durable response emitted while the daemon drains requests.
    if (this.stopped) return;
    if (this.flushTimer || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, EVENT_BATCH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.flushing) return;
    const pendingDurable = this.journal.eventBatch();
    const liveBatch =
      pendingDurable.length === 0 || this.preferLiveEvents
        ? this.takeLiveEventBatch()
        : undefined;
    const durableEvents = liveBatch?.payloads.length ? [] : pendingDurable;
    const livePayloads = liveBatch?.payloads ?? [];
    if (durableEvents.length === 0 && livePayloads.length === 0) return;
    this.flushing = true;
    const liveEvents = livePayloads.map((payload, index) => ({
      sequence: this.liveEventSequence + index + 1,
      payload,
    }));
    const events = durableEvents.length > 0 ? durableEvents : liveEvents;
    const connectorEpoch =
      durableEvents.length > 0
        ? this.journal.connectorEpoch
        : this.liveEventEpoch;
    const body: HostConnectorEventBatch = {
      protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
      connectorEpoch,
      events,
    };
    const abort = new AbortController();
    this.eventRequestAbort = abort;
    try {
      if (durableEvents.length > 0) await this.journal.flush();
      const ack = await this.deliverBatch(body, abort.signal);
      if (
        ack.connectorEpoch !== connectorEpoch ||
        !Number.isSafeInteger(ack.acknowledgedSequence)
      ) {
        throw new Error("OvertChat returned an invalid connector acknowledgement.");
      }
      if (durableEvents.length > 0) {
        await this.journal.acknowledge(ack);
      } else {
        const expected = liveEvents.at(-1)!.sequence;
        if (ack.acknowledgedSequence !== expected) {
          if (
            Number.isSafeInteger(ack.acknowledgedSequence) &&
            ack.acknowledgedSequence >= 0 &&
            ack.acknowledgedSequence < liveEvents[0]!.sequence
          ) {
            // A pre-session-sync server forgot its process-local cursor. Live
            // hints are recoverable from the timeline, so rotate their
            // transport identity and retry them from sequence one.
            this.liveEventEpoch = crypto.randomUUID();
            this.liveEventSequence = 0;
            if (liveBatch) this.restoreLiveEventBatch(liveBatch);
            livePayloads.length = 0;
            this.eventRetryAttempt = 0;
            return;
          }
          throw new Error("OvertChat returned an invalid live-event acknowledgement.");
        }
        this.liveEventSequence = expected;
      }
      this.preferLiveEvents = durableEvents.length > 0;
      this.eventRetryAttempt = 0;
    } catch (error) {
      if (livePayloads.length > 0 && liveBatch) {
        this.restoreLiveEventBatch(liveBatch);
      }
      if (this.stopped) return;
      console.error(
        `Unable to deliver connector events: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await waitForRetry(
        reconnectDelay(this.eventRetryAttempt++),
        this.stopAbort.signal,
      );
    } finally {
      if (this.eventRequestAbort === abort) {
        this.eventRequestAbort = undefined;
      }
      this.flushing = false;
      if (
        !this.stopped &&
        (this.journal.eventBatch().length > 0 ||
          this.liveOverflowHints.size > 0 ||
          this.liveEvents.length > 0)
      ) {
        void this.flush();
      }
    }
  }

  private async deliverBatch(
    body: HostConnectorEventBatch,
    signal: AbortSignal,
  ): Promise<HostConnectorEventAck> {
    const post = async (
      batch: HostConnectorEventBatch,
    ): Promise<HostConnectorEventAck> => {
      const serialized = JSON.stringify(batch);
      const bytes = Buffer.byteLength(serialized);
      if (bytes > HOST_CONNECTOR_EVENT_BATCH_BYTES)
        throw new Error("Connector request exceeds the byte budget.");
      const response = await fetch(
        endpoint(this.config.serverUrl, "/api/host-connectors/events"),
        {
          signal,
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            "Content-Type": "application/json",
            "X-OvertChat-Connector-Build-Version": CONNECTOR_VERSION,
            "X-OvertChat-Connector-Capabilities":
              HOST_CONNECTOR_CAPABILITIES.join(","),
            "X-OvertChat-Connector-Protocol": String(
              HOST_CONNECTOR_PROTOCOL_VERSION,
            ),
          },
          body: serialized,
        },
      );
      if (!response.ok) {
        console.error(
          `[connector:delivery] bytes=${bytes} events=${batch.events.length} fragment=${batch.fragment?.index ?? "none"} status=${response.status}`,
        );
        throw new Error(`OvertChat returned HTTP ${response.status}.`);
      }
      const ack = (await response.json()) as HostConnectorEventAck;
      if (this.eventRetryAttempt > 0)
        console.info(
          `[connector:delivery] recovered bytes=${bytes} events=${batch.events.length} acknowledged_sequence=${ack.acknowledgedSequence}`,
        );
      return ack;
    };
    if (
      Buffer.byteLength(JSON.stringify(body)) <=
      HOST_CONNECTOR_EVENT_BATCH_BYTES
    )
      return post(body);
    if (body.events.length !== 1)
      throw new Error("An oversized batch must contain exactly one event.");
    let event = body.events[0]!;
    const bytes = Buffer.from(JSON.stringify(event));
    if (bytes.length > HOST_CONNECTOR_MAX_EVENT_BYTES) {
      // A failed read must not poison the durable queue for every other session.
      if (event.payload.type === "response") {
        event = {
          sequence: event.sequence,
          payload: {
            type: "response",
            requestId: event.payload.requestId,
            success: false,
            error:
              "The agent response exceeds the 128 MiB transport limit. Inspect the session before retrying a command.",
          },
        };
      } else if (event.payload.type === "session_event") {
        // Live events are hints. Force recovery from the authoritative timeline instead of blocking every session.
        event = {
          ...event,
          payload: {
            ...event.payload,
            envelope: {
              ...event.payload.envelope,
              type: "runtime_event",
              data: { type: "overtchat_resync" },
            },
          },
        };
      } else
        throw new Error(
          "Connector metadata event exceeds the maximum transport size.",
        );
      return post({ ...body, events: [event] });
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const count = Math.ceil(bytes.length / HOST_CONNECTOR_FRAGMENT_BYTES);
    let index = 0;
    while (index < count) {
      const ack = await post({
        ...body,
        events: [],
        fragment: {
          sequence: event.sequence,
          digest,
          index,
          totalBytes: bytes.length,
          data: bytes
            .subarray(
              index * HOST_CONNECTOR_FRAGMENT_BYTES,
              (index + 1) * HOST_CONNECTOR_FRAGMENT_BYTES,
            )
            .toString("base64"),
        },
      });
      if (ack.connectorEpoch !== body.connectorEpoch)
        throw new Error("Invalid fragment epoch acknowledgement.");
      if (
        ack.acknowledgedSequence === event.sequence &&
        ack.nextFragmentIndex === count
      )
        return ack;
      if (
        ack.acknowledgedSequence !== event.sequence - 1 ||
        !Number.isSafeInteger(ack.nextFragmentIndex) ||
        ack.nextFragmentIndex! < 0 ||
        ack.nextFragmentIndex! >= count ||
        (ack.nextFragmentIndex !== 0 && ack.nextFragmentIndex! <= index)
      )
        throw new Error("Invalid fragment acknowledgement.");
      // A restarted receiver explicitly asks to begin again, without acknowledging the event.
      index = ack.nextFragmentIndex!;
    }
    throw new Error("The fragmented event was not acknowledged.");
  }

  private takeLiveEventBatch(): LiveEventBatch {
    const candidates = [...this.liveOverflowHints.values(), ...this.liveEvents];
    const count = boundedEventBatch(
      candidates.map((payload, index) => ({
        sequence: this.liveEventSequence + index + 1,
        payload,
      })),
    ).length;
    const hints = [...this.liveOverflowHints.entries()].slice(0, count);
    for (const [key] of hints) this.liveOverflowHints.delete(key);
    const queued = this.liveEvents.splice(0, count - hints.length);
    return {
      payloads: [...hints.map(([, payload]) => payload), ...queued],
      hints,
      queued,
    };
  }

  private restoreLiveEventBatch(batch: LiveEventBatch): void {
    // A newer displaced event may have replaced a hint while the request was
    // in flight. Never roll that per-subscription marker backward.
    for (const [subscriptionId, payload] of batch.hints) {
      if (!this.liveOverflowHints.has(subscriptionId)) {
        this.liveOverflowHints.set(subscriptionId, payload);
      }
    }
    this.liveEvents.unshift(...batch.queued);
  }

  private async resolveImages(
    images: readonly AgentPromptImage[],
  ): Promise<ResolvedAgentImage[]> {
    return Promise.all(
      images.map(async (image) => {
        const response = await fetch(
          endpoint(
            this.config.serverUrl,
            `/api/host-connectors/uploads/${encodeURIComponent(image.uploadId)}`,
          ),
          {
            headers: {
              Authorization: `Bearer ${this.config.token}`,
            },
          },
        );
        if (!response.ok) {
          throw new Error(
            `Unable to retrieve queued image ${image.filename} (HTTP ${response.status}).`,
          );
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_AGENT_IMAGE_BYTES) {
          throw new Error(`Agent image ${image.filename} is too large.`);
        }
        return {
          ...image,
          data: Buffer.from(bytes).toString("base64"),
        };
      }),
    );
  }
}
