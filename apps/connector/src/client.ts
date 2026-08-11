import {
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorCommand,
  MAX_AGENT_IMAGE_BYTES,
  type AgentPromptImage,
  type HostConnectorEventAck,
  type HostConnectorEventBatch,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import type { ResolvedAgentImage } from "@overtchat/agent-runtime";
import { connectorStatePath, type ConnectorConfig } from "./config.js";
import { ConnectorDaemon } from "./daemon.js";
import { ConnectorStateJournal } from "./state.js";
import { CONNECTOR_VERSION } from "./version.js";

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const EVENT_BATCH_DELAY_MS = 25;

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
  private readonly stopAbort = new AbortController();
  private commandStreamAbort: AbortController | undefined;
  private eventRequestAbort: AbortController | undefined;
  private flushTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private eventRetryAttempt = 0;
  private flushing = false;
  private stopped = false;

  private constructor(
    private readonly config: ConnectorConfig,
    private readonly journal: ConnectorStateJournal,
  ) {
    this.daemon = new ConnectorDaemon(
      (event) => this.enqueue(event),
      (images) => this.resolveImages(images),
      journal,
    );
  }

  static async create(config: ConnectorConfig): Promise<ConnectorClient> {
    const journal = await ConnectorStateJournal.open(
      connectorStatePath(config.connectorId),
    );
    return new ConnectorClient(config, journal);
  }

  async run(): Promise<void> {
    void this.flush();
    while (!this.stopped) {
      try {
        await this.openCommandStream();
      } catch (error) {
        if (this.stopped) break;
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
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.stopAbort.abort();
    this.commandStreamAbort?.abort();
    this.eventRequestAbort?.abort();
    await this.daemon.stop();
    await this.journal.close();
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
          "X-OvertChat-Connector-Version": CONNECTOR_VERSION,
          "X-OvertChat-Connector-Protocol": String(
            HOST_CONNECTOR_PROTOCOL_VERSION,
          ),
        },
      },
    );
    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
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
            await this.daemon.handle(command);
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
    if (this.stopped) return;
    this.journal.enqueue(payload);
    if (this.flushTimer || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, EVENT_BATCH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.flushing) return;
    const events = this.journal.eventBatch();
    if (events.length === 0) return;
    this.flushing = true;
    const body: HostConnectorEventBatch = {
      protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
      connectorEpoch: this.journal.connectorEpoch,
      events,
    };
    const abort = new AbortController();
    this.eventRequestAbort = abort;
    try {
      const response = await fetch(
        endpoint(this.config.serverUrl, "/api/host-connectors/events"),
        {
          signal: abort.signal,
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            "Content-Type": "application/json",
            "X-OvertChat-Connector-Version": CONNECTOR_VERSION,
            "X-OvertChat-Connector-Protocol": String(
              HOST_CONNECTOR_PROTOCOL_VERSION,
            ),
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(`OvertChat returned HTTP ${response.status}.`);
      }
      const ack = (await response.json()) as HostConnectorEventAck;
      if (
        ack.connectorEpoch !== this.journal.connectorEpoch ||
        !Number.isSafeInteger(ack.acknowledgedSequence)
      ) {
        throw new Error("OvertChat returned an invalid connector acknowledgement.");
      }
      await this.journal.acknowledge(ack);
      this.eventRetryAttempt = 0;
    } catch (error) {
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
      if (!this.stopped && this.journal.eventBatch().length > 0) {
        void this.flush();
      }
    }
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
