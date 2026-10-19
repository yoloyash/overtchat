import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAgentRuntimeEnvelope, type AgentRuntimeSnapshot } from "@overtchat/agent-bridge";
import type { AgentRuntimeEvent } from "../providers/types";

const fake = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  emit: (_event: AgentRuntimeEvent) => {},
  getState: vi.fn(), prompt: vi.fn(), abort: vi.fn(), stop: vi.fn(),
}));
vi.mock("../omp/client", () => ({
  startOmp: () => ({
    onEvent: (receive: typeof fake.emit) => { fake.emit = receive; return () => {}; },
    getState: fake.getState,
    getMessages: async () => ({ messages: [] }),
    getAvailableModels: async () => [],
    getCommands: async () => [],
    getSessionStats: async () => { throw new Error("No stats in fixture"); },
    prompt: fake.prompt, abort: fake.abort, stop: fake.stop,
  }),
}));
import { AgentRuntimeRegistry } from "./registry";

const descriptor = {
  connectionId: "connection", workspaceId: "workspace", provider: "omp" as const,
  target: { transport: "local" as const }, executable: "omp", cwd: "/workspace",
  sessionId: "session", providerSessionId: "native", providerSessionPath: "/native.jsonl",
  launchConfig: {},
};
let registry: AgentRuntimeRegistry;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  fake.state = { sessionId: "native", sessionFile: "/native.jsonl", isStreaming: false, isSettled: true, hasPendingAsyncWork: false };
  fake.getState.mockImplementation(async () => ({ ...fake.state }));
  fake.prompt.mockResolvedValue({});
  fake.abort.mockResolvedValue({});
  fake.stop.mockResolvedValue(undefined);
  registry = new AgentRuntimeRegistry({ resolveImages: async () => [] });
});
afterEach(async () => { await registry.stopAll(); vi.useRealTimers(); });

function yielded() {
  fake.state = { ...fake.state, isStreaming: false, isSettled: false, hasPendingAsyncWork: true };
  fake.emit({ type: "message_end", message: { role: "assistant", content: "Answer finished" } });
  fake.emit({ type: "agent_end", isTerminal: false, yielded: true, awaitingAsyncWork: true });
}
function wake() {
  fake.state = { ...fake.state, isStreaming: true };
  fake.emit({ type: "agent_start" });
}
function finish() {
  fake.state = { ...fake.state, isStreaming: false, hasPendingAsyncWork: false, isSettled: true };
  fake.emit({ type: "message_end", message: { role: "assistant", content: "Background result received." } });
  fake.emit({ type: "agent_end", isTerminal: true, yielded: true });
}
function settled() {
  fake.state = { ...fake.state, isStreaming: false, isSettled: true, hasPendingAsyncWork: false };
  fake.emit({ type: "session_settled" });
}

describe("OMP background lifecycle through the real provider adapter", () => {
  it("ends the turn when the agent yields to background work and sends queued input right away", async () => {
    const runtime = await registry.getOrStart(descriptor);
    let replica: AgentRuntimeSnapshot | undefined = runtime.snapshot();
    const unsubscribe = runtime.subscribe((event) => { replica = applyAgentRuntimeEnvelope(replica, event); });
    await runtime.command({ type: "prompt", message: "Start" });
    fake.emit({ type: "agent_start" });
    await runtime.command({ type: "queue", message: "Next" });
    yielded();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.prompt).toHaveBeenCalledTimes(2);
    expect(fake.prompt).toHaveBeenLastCalledWith("Next", undefined, expect.anything());
    fake.emit({ type: "agent_start" });
    yielded();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null, queuedMessages: [] });
    expect(replica).toMatchObject({ status: "idle", activeTurn: null });
    await runtime.refreshState();
    expect(runtime.snapshot()).toMatchObject({ status: "idle", state: { hasPendingAsyncWork: true } });
    unsubscribe();
  });

  it("keeps a provider with background work through idle cleanup and starts a new turn on wake", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    yielded();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot().status).toBe("idle");
    // Stopping the process would cancel the job.
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(fake.stop).not.toHaveBeenCalled();
    wake();
    expect(runtime.snapshot()).toMatchObject({ status: "running", state: { isStreaming: true } });
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(fake.stop).toHaveBeenCalledOnce();
  });

  it("ends the turn on Stop while background work keeps running", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    wake();
    fake.state = { ...fake.state, hasPendingAsyncWork: true, isSettled: false };
    await runtime.command({ type: "queue", message: "After Stop" });
    // Native abort is foreground-only: the async job stays pending.
    fake.abort.mockImplementationOnce(async () => { fake.state = { ...fake.state, isStreaming: false }; });
    await runtime.command({ type: "abort" });
    expect(fake.abort).toHaveBeenCalledOnce();
    expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.prompt).toHaveBeenLastCalledWith("After Stop", undefined, expect.anything());
    yielded();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", state: { hasPendingAsyncWork: true } });
    // The job's result wakes the agent into a new turn.
    wake();
    expect(runtime.snapshot().status).toBe("running");
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
    expect(fake.stop).not.toHaveBeenCalled();
  });

  it("follows a background wake and ignores stale metadata reads", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    yielded();
    await vi.advanceTimersByTimeAsync(0);
    let resolve!: (state: Record<string, unknown>) => void;
    fake.getState.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const refresh = runtime.refreshState();
    fake.emit({ type: "agent_start" });
    resolve({ ...fake.state });
    await refresh;
    expect(runtime.snapshot()).toMatchObject({ status: "running", state: { isStreaming: true } });
    fake.emit({ type: "agent_end", isTerminal: false, yielded: false });
    expect(runtime.snapshot().status).toBe("running");
    settled();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot().status).toBe("idle");
  });

  it("does not release queued input when a wake overtakes a terminal state read", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    fake.emit({ type: "agent_start" });
    await runtime.command({ type: "queue", message: "Next" });
    let resolve!: (state: Record<string, unknown>) => void;
    fake.getState.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    yielded();
    wake();
    resolve({ isStreaming: false, isSettled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot().status).toBe("running");
    expect(fake.prompt).toHaveBeenCalledOnce();
    settled();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.prompt).toHaveBeenCalledTimes(2);
  });

  it("does not lose settlement arriving during the post-abort state read", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    wake();
    const staleState = { ...fake.state };
    let resolve!: (state: Record<string, unknown>) => void;
    fake.getState.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const abort = runtime.command({ type: "abort" });
    await vi.advanceTimersByTimeAsync(0);
    settled();
    resolve(staleState);
    await abort;
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
  });

  it("settles an idle session whose hidden next-turn context keeps isSettled false", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    await runtime.command({ type: "queue", message: "Next" });
    fake.emit({ type: "agent_start" });
    fake.state = {
      ...fake.state, isStreaming: false, hasPendingAsyncWork: false, isSettled: false,
      queuedMessageCount: 1, queuedMessages: { steering: [], followUp: [], liveSteered: 0 },
    };
    fake.emit({ type: "message_end", message: { role: "assistant", content: "Done" } });
    fake.emit({ type: "agent_end", isTerminal: true, yielded: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.prompt).toHaveBeenCalledTimes(2);
    expect(fake.prompt).toHaveBeenLastCalledWith("Next", undefined, expect.anything());
  });

  it("ends the turn when provider state stays unreadable", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    fake.emit({ type: "agent_start" });
    fake.getState.mockRejectedValue(new Error("Timed out waiting for Oh My Pi get_state."));
    fake.emit({ type: "message_end", message: { role: "assistant", content: "Done" } });
    fake.emit({ type: "agent_end", isTerminal: true, yielded: true });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(runtime.snapshot()).toMatchObject({
      status: "idle", activeTurn: null,
      error: expect.any(String),
    });
  });

  it("follows reported work past the settle window until the provider is idle", async () => {
    const runtime = await registry.getOrStart(descriptor);
    await runtime.command({ type: "prompt", message: "Start" });
    fake.emit({ type: "agent_start" });
    fake.state = { ...fake.state, isStreaming: false, isCompacting: true };
    fake.emit({ type: "message_end", message: { role: "assistant", content: "Done" } });
    fake.emit({ type: "agent_end", isTerminal: true, yielded: true });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(runtime.snapshot()).toMatchObject({ status: "running", state: { isCompacting: true } });
    fake.state = { ...fake.state, isCompacting: false };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
    expect(runtime.snapshot().error).toBeUndefined();
  });

  it("attaches idle to a provider whose only work is in the background", async () => {
    fake.state.hasPendingAsyncWork = true;
    fake.state.isSettled = false;
    const runtime = await registry.getOrStart(descriptor);
    expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
  });
});
