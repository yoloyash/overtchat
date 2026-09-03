import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_CAPABILITIES,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  type HostConnectorEventBatch,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";
import { ConnectorClient } from "./client.js";

const directories: string[] = [];

async function config() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-client-"));
  directories.push(directory);
  process.env.OVERTCHAT_CONNECTOR_STATE = path.join(directory, "state.json");
  process.env.OVERTCHAT_CONNECTOR_TIMELINES = path.join(directory, "timelines");
  process.env.OVERTCHAT_CONNECTOR_LOCK = path.join(directory, "connector.lock");
  return {
    serverUrl: "http://127.0.0.1:4717",
    connectorId: "connector",
    token: "secret",
  };
}

function emptyChannel(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.OVERTCHAT_CONNECTOR_STATE;
  delete process.env.OVERTCHAT_CONNECTOR_TIMELINES;
  delete process.env.OVERTCHAT_CONNECTOR_LOCK;
  delete process.env.OVERTCHAT_DISABLE_AGENT_TERMINAL;
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe.sequential("connector client compatibility", () => {
  it("persists a drained request response when shutdown has already started", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyChannel()));
    const client = await ConnectorClient.create(await config());
    const daemon = Reflect.get(client, "daemon") as {
      stop(): Promise<void>;
    };
    const journal = Reflect.get(client, "journal") as {
      close(): Promise<void>;
    };
    const originalDaemonStop = daemon.stop.bind(daemon);
    const originalJournalClose = journal.close.bind(journal);
    let signalDrainStarted!: () => void;
    let finishDrain!: () => void;
    const drainStarted = new Promise<void>((resolve) => {
      signalDrainStarted = resolve;
    });
    const drainFinished = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    vi.spyOn(daemon, "stop").mockImplementation(async () => {
      signalDrainStarted();
      await drainFinished;
      await originalDaemonStop();
    });
    let responseWasDurableBeforeClose = false;
    vi.spyOn(journal, "close").mockImplementation(async () => {
      const persisted = JSON.parse(
        await readFile(process.env.OVERTCHAT_CONNECTOR_STATE!, "utf8"),
      ) as {
        events: Array<{ payload: HostConnectorEventPayload }>;
      };
      responseWasDurableBeforeClose = persisted.events.some(
        (event) =>
          event.payload.type === "response" &&
          event.payload.requestId === "drained-request",
      );
      await originalJournalClose();
    });

    const stopping = client.stop();
    await drainStarted;
    const enqueue = Reflect.get(client, "enqueue") as (
      value: HostConnectorEventPayload,
    ) => void;
    enqueue.call(client, {
      type: "response",
      requestId: "drained-request",
      success: true,
      data: { accepted: true },
    });
    enqueue.call(client, {
      type: "session_event",
      subscriptionId: "disposable-live-hint",
      sessionId: "session",
      envelope: {
        epoch: "timeline",
        sequence: 1,
        type: "runtime_event",
        data: { type: "turn_start" },
      },
    });
    finishDrain();
    await stopping;

    expect(responseWasDurableBeforeClose).toBe(true);
    expect(
      Reflect.get(client, "liveEvents") as HostConnectorEventPayload[],
    ).toHaveLength(0);
  });

  it("advertises its wire protocol and build version", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return emptyChannel();
      }),
    );
    const client = await ConnectorClient.create(await config());
    const running = client.run();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));

    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("x-overtchat-connector-version")).toBeNull();
    expect(headers.get("x-overtchat-connector-build-version")).toBe("0.10.0");
    expect(headers.get("x-overtchat-connector-protocol")).toBe(
      String(HOST_CONNECTOR_PROTOCOL_VERSION),
    );
    expect(headers.get("x-overtchat-connector-capabilities")).toBe(
      HOST_CONNECTOR_CAPABILITIES.join(","),
    );
    await client.stop();
    await running;
  });

  it("keeps ordinary connector capabilities when terminals are disabled", async () => {
    process.env.OVERTCHAT_DISABLE_AGENT_TERMINAL = "1";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return emptyChannel();
      }),
    );
    const client = await ConnectorClient.create(await config());
    const running = client.run();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));

    const headers = new Headers(requests[0]!.init?.headers);
    expect(headers.get("x-overtchat-connector-capabilities")?.split(","))
      .toEqual(
        HOST_CONNECTOR_CAPABILITIES.filter(
          (capability) => capability !== "workspace-terminal-v1",
        ),
      );
    await client.stop();
    await running;
  });

  it("rotates recoverable live hints when a legacy server forgets its cursor", async () => {
    const batches: HostConnectorEventBatch[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/channel")) return emptyChannel();
        const batch = JSON.parse(String(init?.body)) as HostConnectorEventBatch;
        batches.push(batch);
        const acknowledgedSequence =
          batches.length === 1 ? 0 : batch.events.at(-1)!.sequence;
        return Response.json({
          connectorEpoch: batch.connectorEpoch,
          acknowledgedSequence,
        });
      }),
    );
    const client = await ConnectorClient.create(await config());
    const running = client.run();
    const payload: HostConnectorEventPayload = {
      type: "session_event",
      subscriptionId: "subscription",
      sessionId: "session",
      envelope: {
        epoch: "timeline",
        sequence: 1,
        type: "runtime_event",
        data: { type: "turn_start" },
      },
    };
    const enqueue = Reflect.get(client, "enqueue") as (
      value: HostConnectorEventPayload,
    ) => void;
    enqueue.call(client, payload);

    await vi.waitFor(() => expect(batches).toHaveLength(2));
    expect(batches[0]!.events.map((event) => event.sequence)).toEqual([1]);
    expect(batches[1]!.events.map((event) => event.sequence)).toEqual([1]);
    expect(batches[1]!.connectorEpoch).not.toBe(batches[0]!.connectorEpoch);
    await client.stop();
    await running;
  });

  it("delivers session-directory upserts through the event outbox", async () => {
    const batches: HostConnectorEventBatch[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/channel")) return emptyChannel();
        const batch = JSON.parse(String(init?.body)) as HostConnectorEventBatch;
        batches.push(batch);
        return Response.json({
          connectorEpoch: batch.connectorEpoch,
          acknowledgedSequence: batch.events.at(-1)!.sequence,
        });
      }),
    );
    const client = await ConnectorClient.create(await config());
    const running = client.run();
    const enqueue = Reflect.get(client, "enqueue") as (
      value: HostConnectorEventPayload,
    ) => void;
    enqueue.call(client, {
      type: "session_update",
      session: { sessionId: "session", runtimeStatus: "running" },
    });

    await vi.waitFor(() =>
      expect(
        batches.flatMap((batch) => batch.events).some(
          (event) =>
            event.payload.type === "session_update" &&
            event.payload.session.sessionId === "session" &&
            event.payload.session.runtimeStatus === "running",
        ),
      ).toBe(true),
    );
    expect(
      Reflect.get(client, "liveEvents") as HostConnectorEventPayload[],
    ).toHaveLength(0);
    await client.stop();
    await running;
  });

  it("terminates the connector loop after an unrecoverable timeline failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyChannel()));
    const client = await ConnectorClient.create(await config());
    const running = client.run();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const failure = new Error("Host Connector timeline persistence failed");

    const fail = Reflect.get(client, "fail") as (error: Error) => void;
    fail.call(client, failure);

    await expect(running).rejects.toBe(failure);
    await client.stop();
  });

  it("retains a reconciliation hint for a quiet session when live events overflow", async () => {
    const batches: HostConnectorEventBatch[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const batch = JSON.parse(String(init?.body)) as HostConnectorEventBatch;
        batches.push(batch);
        return Response.json({
          connectorEpoch: batch.connectorEpoch,
          acknowledgedSequence: batch.events.at(-1)!.sequence,
        });
      }),
    );
    const client = await ConnectorClient.create(await config());
    const enqueue = Reflect.get(client, "enqueue") as (
      value: HostConnectorEventPayload,
    ) => void;
    const sessionEvent = (
      subscriptionId: string,
      sessionId: string,
      sequence: number,
    ): HostConnectorEventPayload => ({
      type: "session_event",
      subscriptionId,
      sessionId,
      envelope: {
        epoch: `timeline-${sessionId}`,
        sequence,
        type: "runtime_event",
        data: { type: "turn_start" },
      },
    });
    enqueue.call(client, sessionEvent("quiet-subscription", "quiet", 1));
    for (let sequence = 1; sequence <= 2_049; sequence += 1) {
      enqueue.call(
        client,
        sessionEvent("busy-subscription", "busy", sequence),
      );
    }

    const flush = Reflect.get(client, "flush") as () => Promise<void>;
    await flush.call(client);
    await vi.waitFor(() => expect(batches.length).toBeGreaterThan(0));

    expect(
      batches.flatMap((batch) => batch.events).some(
        (event) =>
          event.payload.type === "session_event" &&
          event.payload.subscriptionId === "quiet-subscription",
      ),
    ).toBe(true);
    await client.stop();
  });
});
