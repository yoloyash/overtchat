import {
  HOST_CONNECTOR_PROTOCOL_VERSION,
  type HostConnectorCommand,
  type HostConnectorEvent,
  type HostConnectorEventBatch,
} from "@overtchat/agent-bridge";
import type { ConnectorConfig } from "./config.js";
import { ConnectorRuntime } from "./runtime.js";
import { CONNECTOR_VERSION } from "./version.js";

const RECONNECT_DELAY_MS = 1_000;
const EVENT_BATCH_DELAY_MS = 25;

function endpoint(serverUrl: string, path: string): string {
  return `${serverUrl}${path}`;
}

export class ConnectorClient {
  private readonly events: HostConnectorEvent[] = [];
  private readonly runtime: ConnectorRuntime;
  private commandStreamAbort: AbortController | undefined;
  private eventRequestAbort: AbortController | undefined;
  private flushTimer: NodeJS.Timeout | undefined;
  private flushing = false;
  private stopped = false;

  constructor(private readonly config: ConnectorConfig) {
    this.runtime = new ConnectorRuntime((event) => this.enqueue(event));
  }

  async run(): Promise<void> {
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
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.events.length = 0;
    this.commandStreamAbort?.abort();
    this.eventRequestAbort?.abort();
    this.runtime.stop();
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
      throw new Error(`OvertChat returned HTTP ${response.status}.`);
    }
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
            await this.runtime.handle(
              JSON.parse(line) as HostConnectorCommand,
            );
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

  private enqueue(event: HostConnectorEvent): void {
    if (this.stopped) return;
    this.events.push(event);
    if (this.flushTimer || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, EVENT_BATCH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.flushing || this.events.length === 0) return;
    this.flushing = true;
    const events = this.events.splice(0, this.events.length);
    const body: HostConnectorEventBatch = {
      protocolVersion: HOST_CONNECTOR_PROTOCOL_VERSION,
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
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(`OvertChat returned HTTP ${response.status}.`);
      }
    } catch (error) {
      if (this.stopped) return;
      this.events.unshift(...events);
      console.error(
        `Unable to deliver connector events: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    } finally {
      if (this.eventRequestAbort === abort) {
        this.eventRequestAbort = undefined;
      }
      this.flushing = false;
      if (!this.stopped && this.events.length > 0) void this.flush();
    }
  }
}
