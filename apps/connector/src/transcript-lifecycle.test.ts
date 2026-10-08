import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeEvent } from "@overtchat/agent-runtime/providers/types";
import { projectAgentTranscript } from "@overtchat/shared/agent-presentation";

const provider = vi.hoisted(() => ({
  messages: [] as unknown[],
  getMessages: vi.fn(),
  emit: (() => {}) as (event: AgentRuntimeEvent) => void,
  model: "initial/model",
  streaming: false,
}));
vi.mock("@overtchat/agent-runtime/providers/registry", () => ({
  agentProviderAdapter: () => ({
    provider: "omp",
    startSession: () => ({
      onEvent: (receive: (event: AgentRuntimeEvent) => void) => {
        provider.emit = receive;
        return () => {};
      },
      getState: async () => ({
        sessionId: "native-session",
        sessionFile: "/sessions/native.jsonl",
        isStreaming: provider.streaming,
        model: { provider: "omp", id: provider.model },
      }),
      getMessages: provider.getMessages,
      getAvailableModels: async () => [],
      getSessionStats: async () => { throw new Error("no usage in fixture"); },
      getCommands: async () => [],
      setModel: async (model: string) => { provider.model = model; },
      setThinkingLevel: async () => {},
      setSessionName: async () => {},
      setAutoCompaction: async () => {},
      abort: async () => {},
      rewind: async () => {},
      stop: async () => {},
    }),
    sessionIdentity: () => ({
      providerSessionId: "native-session",
      providerSessionPath: "/sessions/native.jsonl",
      sessionName: null,
    }),
    mergeCommands: (commands: unknown[]) => commands,
    normalizeCommand: (command: unknown) => command,
    commandsFromEvent: () => null,
    createEventClassifier: () => ({
      reset: () => {},
      classify: (event: AgentRuntimeEvent) => ({
        started: event.type === "agent_start",
        terminal: event.type === "agent_end",
      }),
    }),
  }),
}));

import { AgentRuntimeRegistry, type AgentSessionRuntime } from "@overtchat/agent-runtime/runtime/registry";
import { ConnectorTimelineStore } from "./timeline.js";

const descriptor = {
  sessionId: "session",
  providerSessionId: "native-session",
  providerSessionPath: "/sessions/native.jsonl",
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "omp" as const,
  target: { transport: "local" as const },
  executable: "omp",
  cwd: "/workspace",
  launchConfig: {},
};
const prompt = { id: "prompt", role: "user", content: "Measure startup", timestamp: 1 };
const answer = {
  id: "answer", role: "assistant", timestamp: 4,
  content: [{ type: "text", text: "Measured startup timings." }],
};
const compacted = [{ role: "compactionSummary", content: "Earlier work" }, prompt, answer];
const directories: string[] = [];
const registries: AgentRuntimeRegistry[] = [];
const stores: ConnectorTimelineStore[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  provider.model = "initial/model";
  provider.streaming = false;
  provider.messages = [prompt];
  provider.getMessages.mockImplementation(async () => ({ messages: provider.messages }));
});
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.stopAll();
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function open(directory?: string) {
  if (!directory) {
    directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-transcript-"));
    directories.push(directory);
  }
  const store = await ConnectorTimelineStore.open(directory);
  stores.push(store);
  const registry = new AgentRuntimeRegistry({
    resolveImages: async () => [],
    loadTranscript: ({ sessionId, providerSessionId }) => store.readTranscript(sessionId, providerSessionId),
  });
  registries.push(registry);
  return { directory, store, registry };
}
async function attach(store: ConnectorTimelineStore, runtime: AgentSessionRuntime) {
  await store.openSession(descriptor.sessionId, descriptor.providerSessionId, runtime.snapshot());
  const commits: Promise<unknown>[] = [];
  runtime.observe((envelope) => { commits.push(store.commit(descriptor.sessionId, envelope)); });
  return async () => {
    await store.flush(descriptor.sessionId);
    await Promise.all(commits.splice(0));
  };
}

describe("display transcript lifecycle", () => {
  it("keeps live order through compacted context, settings, disk restart and an explicit rewind", async () => {
    const { directory, store, registry } = await open();
    const runtime = await registry.getOrStart(descriptor);
    const flush = await attach(store, runtime);
    provider.emit({ type: "message_end", message: {
      id: "tools", role: "assistant", timestamp: 2,
      content: [{ type: "toolCall", id: "call", name: "bash", arguments: { command: "true" } }],
    } });
    provider.emit({ type: "tool_execution_end", toolCallId: "call", toolName: "bash",
      result: { content: [{ type: "text", text: "done" }] } });
    provider.emit({ type: "message_end", message: {
      id: "notice", role: "custom", customType: "async-result", timestamp: 3,
      content: "<system-notice>Background job bg_1 completed</system-notice>",
    } });
    provider.emit({ type: "message_end", message: answer });
    const displayed = structuredClone(runtime.snapshot().messages);
    provider.messages = compacted;
    provider.emit({ type: "agent_end", messages: [answer] });
    await runtime.refreshState();
    for (const command of [
      { type: "set_model", modelId: "other/model" },
      { type: "set_thinking_level", level: "high" },
      { type: "set_session_name", name: "Timings" },
      { type: "set_auto_compaction", enabled: true },
    ] as const) await runtime.command(command);
    await flush();
    expect(provider.getMessages).toHaveBeenCalledOnce();
    expect(runtime.snapshot().messages).toEqual(displayed);
    expect(await store.readTranscript("session", "native-session")).toEqual(displayed);
    expect(projectAgentTranscript(displayed).at(-1)).toMatchObject({ type: "assistant_text" });

    await registry.stopAll();
    await flush();
    await store.close();
    const resumed = await open(directory);
    const nextRuntime = await resumed.registry.getOrStart(descriptor);
    const flushNext = await attach(resumed.store, nextRuntime);
    expect(nextRuntime.snapshot().messages).toEqual(displayed);
    expect(provider.getMessages).toHaveBeenCalledOnce();
    await nextRuntime.command({ type: "set_model", modelId: "third/model" });
    await flushNext();
    expect(await resumed.store.readTranscript("session", "native-session")).toEqual(displayed);

    // Explicit conversation changes import one whole branch and discard its old rows.
    provider.messages = [];
    await nextRuntime.rewind("prompt", "conversation");
    await flushNext();
    await resumed.store.openSession("session", "native-session", nextRuntime.snapshot(), true);
    expect(provider.getMessages).toHaveBeenCalledTimes(2);
    expect(await resumed.store.readTranscript("session", "native-session")).toEqual([]);
  });

  it("retains existing misordered history until an explicit reload", async () => {
    const first = await open();
    const runtime = await first.registry.getOrStart(descriptor);
    const existing = [...compacted, {
      role: "toolResult", toolCallId: "old-call", content: "Misplaced old result",
    }, {
      role: "custom", customType: "async-result", content: "Background job bg_1 completed",
    }];
    const oldCursor = await first.store.openSession("session", "native-session", {
      ...runtime.snapshot(), messages: existing,
    });
    await first.registry.stopAll();
    await first.store.close();

    const resumed = await open(first.directory);
    provider.messages = compacted;
    const restored = await resumed.registry.getOrStart(descriptor);
    await attach(resumed.store, restored);
    await restored.command({ type: "set_model", modelId: "other/model" });
    expect(restored.snapshot().messages).toEqual(existing);
    expect(provider.getMessages).toHaveBeenCalledOnce();
    expect((await resumed.store.sync("session", oldCursor)).cursor.epoch).toBe(oldCursor.epoch);
    expect(await resumed.store.readTranscript("session", "different-session")).toBeNull();

    await resumed.registry.stopAll();
    await resumed.store.flush("session");
    provider.getMessages.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(resumed.registry.getOrStart(descriptor, { hydrateHistory: true }))
      .rejects.toThrow("provider unavailable");
    expect(await resumed.store.readTranscript("session", "native-session")).toEqual(existing);

    const reloaded = await resumed.registry.getOrStart(descriptor, { hydrateHistory: true });
    const cursor = await resumed.store.openSession("session", "native-session", reloaded.snapshot(), true);
    expect(cursor.epoch).not.toBe(oldCursor.epoch);
    expect(await resumed.store.readTranscript("session", "native-session")).toEqual(compacted);
  });
});
