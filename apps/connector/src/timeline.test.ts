import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";
import { ConnectorTimelineStore } from "./timeline.js";

const SESSION_ID = "session";
const PROVIDER_SESSION_ID = "provider-session";
const directories: string[] = [];
const stores: ConnectorTimelineStore[] = [];

function snapshot(
  sessionId = SESSION_ID,
  state: Record<string, unknown> = { isStreaming: false },
): AgentRuntimeSnapshot {
  return {
    sessionId,
    provider: "pi",
    capabilities: { steer: true },
    status: "idle",
    activeTurn: null,
    state,
    messages: [],
    models: [],
    commands: [],
    queuedMessages: [],
    stats: {
      sessionFile: null,
      sessionId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
      cost: 0,
    },
  };
}

function runtimeEvent(
  data: Extract<AgentRuntimeEnvelope, { type: "runtime_event" }>["data"],
): AgentRuntimeEnvelope {
  return {
    epoch: "provider-runtime",
    sequence: 1,
    type: "runtime_event",
    data,
  };
}

function timelineFile(directory: string, sessionId = SESSION_ID): string {
  const name = createHash("sha256").update(sessionId).digest("hex");
  return path.join(directory, `${name}.jsonl`);
}

async function createStore(): Promise<{
  directory: string;
  file: string;
  store: ConnectorTimelineStore;
}> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-timeline-"),
  );
  directories.push(directory);
  const store = await ConnectorTimelineStore.open(directory);
  stores.push(store);
  return { directory, file: timelineFile(directory), store };
}

async function reopen(directory: string): Promise<ConnectorTimelineStore> {
  const store = await ConnectorTimelineStore.open(directory);
  stores.push(store);
  return store;
}

async function commit(
  store: ConnectorTimelineStore,
  data: Extract<AgentRuntimeEnvelope, { type: "runtime_event" }>["data"],
): Promise<AgentRuntimeEnvelope | null> {
  const pending = store.commit(SESSION_ID, runtimeEvent(data));
  await store.flush(SESSION_ID);
  return pending;
}

afterEach(async () => {
  await Promise.all(
    stores.splice(0).map((store) => store.close().catch(() => {})),
  );
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("connector session timeline", () => {
  it("persists an event before live delivery and restores its exact cursor", async () => {
    const { directory, file, store } = await createStore();
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(),
    );
    const delivered: AgentRuntimeEnvelope[] = [];
    const subscription = await store.subscribe(
      SESSION_ID,
      initial,
      (envelope) => {
        expect(readFileSync(file, "utf8")).toContain(
          `"sequence":${envelope.sequence}`,
        );
        delivered.push(envelope);
      },
    );

    const canonical = await commit(store, {
      type: "overtchat_status",
      status: "running",
      startedAt: 42,
    });

    expect(canonical).toMatchObject({
      epoch: initial.epoch,
      sequence: 1,
      type: "runtime_event",
    });
    expect(delivered).toEqual([canonical]);
    subscription.unsubscribe();
    await store.close();

    const restored = await reopen(directory);
    await expect(restored.sync(SESSION_ID, initial)).resolves.toEqual({
      reset: false,
      cursor: { epoch: initial.epoch, sequence: 1 },
      events: [canonical],
    });
    await expect(
      restored.sync(SESSION_ID, {
        epoch: initial.epoch,
        sequence: 1,
      }),
    ).resolves.toEqual({
      reset: false,
      cursor: { epoch: initial.epoch, sequence: 1 },
      events: [],
    });
  });

  it("replays reducer-derived timestamps into a deeply identical snapshot", async () => {
    const { directory, file, store } = await createStore();
    await store.openSession(SESSION_ID, PROVIDER_SESSION_ID, snapshot());
    const source = runtimeEvent({ type: "agent_start" });
    const commits = [
      store.commit(SESSION_ID, source),
      store.commit(
        SESSION_ID,
        runtimeEvent({ type: "command_output", text: "Current model" }),
      ),
      store.commit(
        SESSION_ID,
        runtimeEvent({
          type: "tool_execution_update",
          toolCallId: "call",
          toolName: "bash",
          partialResult: {
            content: [{ type: "text", text: "partial output" }],
          },
        }),
      ),
    ];
    await store.flush(SESSION_ID);
    const canonical = await Promise.all(commits);
    const before = await store.sync(SESSION_ID);

    expect(source.data).not.toHaveProperty("overtchatRecordedAt");
    expect(canonical).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ overtchatRecordedAt: expect.any(Number) }),
      }),
      expect.objectContaining({
        data: expect.objectContaining({ overtchatRecordedAt: expect.any(Number) }),
      }),
      expect.objectContaining({
        data: expect.objectContaining({ overtchatRecordedAt: expect.any(Number) }),
      }),
    ]);
    expect(await readFile(file, "utf8")).toContain("overtchatRecordedAt");
    expect(before).toMatchObject({
      reset: true,
      cursor: { sequence: 3 },
      snapshot: {
        activeTurn: { startedAt: expect.any(Number) },
        messages: [
          expect.objectContaining({ role: "custom", timestamp: expect.any(Number) }),
          expect.objectContaining({
            role: "toolResult",
            timestamp: expect.any(Number),
          }),
        ],
      },
    });

    await store.close();
    const restored = await reopen(directory);
    const after = await restored.sync(SESSION_ID);
    expect(after).toEqual(before);
  });

  it("does not duplicate a recorded output when a later runtime snapshot includes it", async () => {
    const { store } = await createStore();
    await store.openSession(SESSION_ID, PROVIDER_SESSION_ID, snapshot());
    await commit(store, {
      type: "command_output",
      text: "Current model: GPT-5.6",
      overtchatRecordedAt: 2_345,
    });
    const pending = store.commit(SESSION_ID, {
      epoch: "provider-runtime",
      sequence: 2,
      type: "snapshot",
      data: {
        ...snapshot(),
        messages: [
          {
            role: "custom",
            content: "Current model: GPT-5.6",
            display: true,
            timestamp: 2_345,
          },
        ],
      },
    });
    await store.flush(SESSION_ID);
    await pending;

    await expect(store.sync(SESSION_ID)).resolves.toMatchObject({
      reset: true,
      snapshot: {
        messages: [
          {
            role: "custom",
            content: "Current model: GPT-5.6",
            display: true,
            timestamp: 2_345,
          },
        ],
      },
    });
  });

  it("closes the subscribe catch-up race without duplicating live events", async () => {
    const { store } = await createStore();
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(),
    );
    const firstCommit = store.commit(
      SESSION_ID,
      runtimeEvent({ type: "overtchat_status", status: "running" }),
    );
    const live: AgentRuntimeEnvelope[] = [];
    const subscriptionPromise = store.subscribe(
      SESSION_ID,
      initial,
      (envelope) => live.push(envelope),
    );

    const [first, subscription] = await Promise.all([
      firstCommit,
      subscriptionPromise,
    ]);
    expect(subscription.sync).toEqual({
      reset: false,
      cursor: { epoch: initial.epoch, sequence: 1 },
      events: [first],
    });
    expect(live).toEqual([]);

    const second = await commit(store, {
      type: "overtchat_status",
      status: "idle",
    });
    expect(second).toMatchObject({ sequence: 2 });
    expect(live).toEqual([second]);
    subscription.unsubscribe();
  });

  it("returns deltas only for a retained cursor and resets invalid cursors", async () => {
    const { store } = await createStore();
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(),
    );
    const first = await commit(store, {
      type: "overtchat_status",
      status: "running",
      startedAt: 42,
    });
    const second = await commit(store, {
      type: "overtchat_status",
      status: "idle",
    });

    await expect(
      store.sync(SESSION_ID, {
        epoch: initial.epoch,
        sequence: 1,
      }),
    ).resolves.toEqual({
      reset: false,
      cursor: { epoch: initial.epoch, sequence: 2 },
      events: [second],
    });
    await expect(store.sync(SESSION_ID, initial)).resolves.toMatchObject({
      reset: false,
      events: [first, second],
    });
    await expect(store.sync(SESSION_ID)).resolves.toMatchObject({
      reset: true,
      cursor: { epoch: initial.epoch, sequence: 2 },
      snapshot: { status: "idle" },
    });
    await expect(
      store.sync(SESSION_ID, { epoch: "stale-epoch", sequence: 2 }),
    ).resolves.toMatchObject({ reset: true });
    await expect(
      store.sync(SESSION_ID, { epoch: initial.epoch, sequence: 3 }),
    ).resolves.toMatchObject({ reset: true });
  });

  it("does not duplicate plain provider history across repeated resumes", async () => {
    const { store } = await createStore();
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hello back" },
    ];
    const providerSnapshot = { ...snapshot(), messages };

    await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      providerSnapshot,
    );
    await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      providerSnapshot,
    );
    await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      providerSnapshot,
    );

    await expect(store.sync(SESSION_ID)).resolves.toMatchObject({
      reset: true,
      snapshot: { messages },
    });
  });

  it("accepts authoritative restart checkpoints and publishes provider rotation", async () => {
    const { directory, store } = await createStore();
    const durable = {
      ...snapshot(),
      messages: [
        {
          role: "user",
          content: "Queued before the provider persisted it",
          overtchatSubmissionId: "submission-1",
        },
      ],
    };
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      durable,
    );
    await commit(store, {
      type: "overtchat_status",
      status: "running",
    });

    const refreshed = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      {
        ...snapshot(SESSION_ID, { generation: 2 }),
        messages: [
          { id: "provider-message", role: "assistant", content: "Caught up" },
        ],
      },
    );
    expect(refreshed).toEqual({ epoch: initial.epoch, sequence: 2 });
    await expect(
      store.sync(SESSION_ID),
    ).resolves.toMatchObject({
      reset: true,
      cursor: refreshed,
      snapshot: {
        state: { generation: 2 },
        status: "idle",
        messages: [expect.objectContaining({ id: "provider-message" })],
      },
    });

    const runtimeSnapshot = store.commit(SESSION_ID, {
      epoch: "replacement-runtime-ephemeral",
      sequence: 99,
      type: "snapshot",
      data: snapshot(SESSION_ID, { generation: 3 }),
    });
    await store.flush(SESSION_ID);
    await expect(runtimeSnapshot).resolves.toMatchObject({
      epoch: initial.epoch,
      sequence: 3,
      type: "snapshot",
      data: { messages: [] },
    });

    const delivered: AgentRuntimeEnvelope[] = [];
    const subscription = await store.subscribe(
      SESSION_ID,
      { epoch: initial.epoch, sequence: 3 },
      (envelope) => delivered.push(envelope),
    );

    const rotated = await store.openSession(
      SESSION_ID,
      "replacement-provider-session",
      snapshot(SESSION_ID, { generation: 3 }),
    );
    expect(rotated.sequence).toBe(1);
    expect(rotated.epoch).not.toBe(initial.epoch);
    expect(delivered).toEqual([
      expect.objectContaining({
        ...rotated,
        type: "snapshot",
        data: expect.objectContaining({ state: { generation: 3 } }),
      }),
    ]);
    subscription.unsubscribe();
    await store.close();

    const restored = await reopen(directory);
    await expect(restored.sync(SESSION_ID, refreshed)).resolves.toMatchObject({
      reset: true,
      cursor: rotated,
      snapshot: { state: { generation: 3 } },
    });
  });

  it("checkpoints an oversized tail and resets stale cursors after reopen", async () => {
    const { directory, file, store } = await createStore();
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(),
    );
    const commits = Array.from({ length: 501 }, (_, index) =>
      store.commit(
        SESSION_ID,
        runtimeEvent({
          type: "overtchat_status",
          status: index % 2 === 0 ? "running" : "idle",
          startedAt: index,
        }),
      ),
    );
    await store.flush(SESSION_ID);
    await Promise.all(commits);

    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(1);
    await expect(store.sync(SESSION_ID, initial)).resolves.toMatchObject({
      reset: true,
      cursor: { epoch: initial.epoch, sequence: 501 },
    });
    await store.close();

    const restored = await reopen(directory);
    await expect(restored.sync(SESSION_ID, initial)).resolves.toMatchObject({
      reset: true,
      cursor: { epoch: initial.epoch, sequence: 501 },
    });
  });

  it.each([
    {
      name: "a partial final record",
      damage: (raw: string) =>
        `${raw}{"format":1,"type":"event","envelope":`,
    },
    {
      name: "a complete record missing its final newline",
      damage: (raw: string) => raw.slice(0, -1),
    },
  ])("repairs $name before accepting another event", async ({ damage }) => {
    const { directory, file, store } = await createStore();
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(),
    );
    const first = await commit(store, {
      type: "overtchat_status",
      status: "running",
      startedAt: 42,
    });
    await store.close();
    const raw = await readFile(file, "utf8");
    await writeFile(file, damage(raw), "utf8");

    const restored = await reopen(directory);
    await expect(restored.sync(SESSION_ID, initial)).resolves.toMatchObject({
      reset: true,
      cursor: { epoch: initial.epoch, sequence: 1 },
      snapshot: { status: "running" },
    });
    const repaired = await readFile(file, "utf8");
    expect(repaired.endsWith("\n")).toBe(true);
    expect(repaired.trim().split("\n")).toHaveLength(1);

    const second = await commit(restored, {
      type: "overtchat_status",
      status: "idle",
    });
    expect(first).toMatchObject({ sequence: 1 });
    expect(second).toMatchObject({ sequence: 2 });
    await restored.close();

    const reopened = await reopen(directory);
    await expect(
      reopened.sync(SESSION_ID, {
        epoch: initial.epoch,
        sequence: 1,
      }),
    ).resolves.toEqual({
      reset: false,
      cursor: { epoch: initial.epoch, sequence: 2 },
      events: [second],
    });
  });

  it("makes an append failure terminal and never publishes the event", async () => {
    const { file, store } = await createStore();
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(),
    );
    const delivered: AgentRuntimeEnvelope[] = [];
    await store.subscribe(SESSION_ID, initial, (envelope) => {
      delivered.push(envelope);
    });
    await rm(file);
    await mkdir(file);

    const pending = store.commit(
      SESSION_ID,
      runtimeEvent({ type: "overtchat_status", status: "running" }),
    );
    const flushing = store.flush(SESSION_ID);
    const failure = await pending.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "timeline persistence failed",
    );
    await expect(flushing).rejects.toBe(failure);
    expect(delivered).toEqual([]);
    expect(() =>
      store.commit(
        SESSION_ID,
        runtimeEvent({ type: "overtchat_status", status: "idle" }),
      ),
    ).toThrow(failure as Error);
    await expect(store.sync(SESSION_ID, initial)).rejects.toBe(failure);
    await expect(store.close()).rejects.toBe(failure);
  });

  it("cleans its temporary checkpoint when atomic replacement fails", async () => {
    const { directory, file, store } = await createStore();
    await mkdir(file);

    await expect(
      store.openSession(SESSION_ID, PROVIDER_SESSION_ID, snapshot()),
    ).rejects.toThrow("timeline persistence failed");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual(
      [],
    );
    await expect(store.close()).rejects.toThrow("timeline persistence failed");
  });

  it("serializes a pending commit ahead of deletion and durably rotates on reopen", async () => {
    const { directory, file, store } = await createStore();
    const initial = await store.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(),
    );
    const pending = store.commit(
      SESSION_ID,
      runtimeEvent({ type: "overtchat_status", status: "running" }),
    );
    const deletion = store.deleteSession(SESSION_ID);
    const late = store.commit(
      SESSION_ID,
      runtimeEvent({ type: "overtchat_status", status: "idle" }),
    );
    const lateRejection = expect(late).rejects.toThrow(
      "timeline has been deleted",
    );

    await expect(pending).resolves.toMatchObject({ sequence: 1 });
    await lateRejection;
    await deletion;
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    await store.close();

    const restored = await reopen(directory);
    await expect(restored.sync(SESSION_ID)).rejects.toThrow(
      "timeline is not initialized",
    );
    const rotated = await restored.openSession(
      SESSION_ID,
      PROVIDER_SESSION_ID,
      snapshot(SESSION_ID, { generation: 2 }),
    );
    expect(rotated).toMatchObject({ sequence: 0 });
    expect(rotated.epoch).not.toBe(initial.epoch);
  });

  it("treats newline-terminated corruption as fatal instead of a torn tail", async () => {
    const { directory, file, store } = await createStore();
    await store.openSession(SESSION_ID, PROVIDER_SESSION_ID, snapshot());
    await store.close();
    await appendFile(file, "not-json\n", "utf8");

    const restored = await reopen(directory);
    await expect(restored.sync(SESSION_ID)).rejects.toThrow(
      "timeline persistence failed",
    );
    await expect(restored.close()).rejects.toThrow(
      "timeline persistence failed",
    );
  });
});
