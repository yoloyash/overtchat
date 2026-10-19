import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { startOmp } from "./client";
import { ompProviderAdapter } from "../providers/omp";
import { AgentSessionRuntime } from "../runtime/registry";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

beforeAll(configureLocalTestProcessSpawner);

type FixtureReply = { delta: Record<string, unknown>; finish: "stop" | "tool_calls" };

/** Serve scripted OpenAI-compatible replies to an isolated OMP profile. */
async function startModelFixture(reply: (request: number) => FixtureReply | Promise<FixtureReply>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "overtchat-omp-background-"));
  const agentDirectory = path.join(root, "agent");
  await mkdir(agentDirectory);
  const fixture = { root, agentDirectory, requests: 0, server: createServer(async (request, response) => {
    for await (const _ of request) { /* Drain the model request. */ }
    const { delta, finish } = await reply(++fixture.requests);
    // A held reply can outlive the aborted request that asked for it.
    if (response.destroyed) return;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      response.write(`data: ${JSON.stringify({ id: `reply-${fixture.requests}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: "assistant" });
    chunk(delta);
    chunk({}, finish);
    response.end("data: [DONE]\n\n");
  }) };
  await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
  const address = fixture.server.address();
  if (!address || typeof address === "string") throw new Error("Missing model fixture port");
  await writeFile(path.join(agentDirectory, "models.yml"), JSON.stringify({ providers: {
    fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, auth: "none", api: "openai-completions", models: [
      { id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096 },
    ] },
  } }));
  return {
    ...fixture,
    get requests() { return fixture.requests; },
    async close() {
      fixture.server.closeAllConnections();
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

function toolCall(id: string, name: string, args: unknown): FixtureReply {
  return {
    delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
    finish: "tool_calls",
  };
}

// Real OMP and bash, with an isolated profile and a loopback model fixture.
// No configured model credentials or existing native sessions are used.
describe.runIf(process.env.RUN_OMP_BACKGROUND_INTEGRATION === "1")("installed OMP background work", () => {
  it.each(["finish", "abort"] as const)("handles a real async bash job: %s", async (action) => {
    let releaseReply!: () => void;
    const replyHeld = new Promise<void>((resolve) => { releaseReply = resolve; });
    const fixture = await startModelFixture(async (request) => {
      if (request === 1) {
        return toolCall("background-bash", "bash", { command: "while [ ! -f release-job ]; do sleep 0.1; done; echo BACKGROUND_DONE", timeout: 20, async: true });
      }
      // Hold the answer so Stop lands mid-turn while the job runs.
      if (request === 2 && action === "abort") await replyHeld;
      return { delta: { content: request === 2 ? "Answer finished; background work continues." : "Background result received." }, finish: "stop" };
    });
    const { root, agentDirectory } = fixture;
    const client = startOmp({ transport: "local" }, {
      executable: process.env.OMP_COMMAND ?? "omp", cwd: root,
      env: { PI_CODING_AGENT_DIR: agentDirectory }, model: "fixture/fixture",
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-pty", "--no-title", "--tools", "bash"],
    });
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    const starts = () => events.filter((event) => event.type === "agent_start").length;
    let runtime: AgentSessionRuntime | undefined;
    try {
      const state = await client.getState();
      runtime = new AgentSessionRuntime("session", "connection", "workspace", ompProviderAdapter, client, {
        state, messages: [], models: [], commands: [], stats: await client.getSessionStats(),
      }, {}, async () => [], async () => {}, async () => {}, [], () => {});
      await runtime.command({ type: "prompt", message: "Start the background fixture." });
      if (action === "abort") {
        await vi.waitFor(() => expect(fixture.requests).toBe(2), { timeout: 15_000 });
        await expect(client.getState()).resolves.toMatchObject({ isStreaming: true, hasPendingAsyncWork: true });
        await runtime.command({ type: "abort" });
        // Stop ends the turn, but OMP's native abort leaves async jobs running.
        expect(runtime.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
        await expect(client.getState()).resolves.toMatchObject({ isStreaming: false, hasPendingAsyncWork: true });
      } else {
        // Yielding to the job hands control back.
        await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
          type: "agent_end", yielded: true, isTerminal: false, awaitingAsyncWork: true,
        })), { timeout: 15_000 });
        await vi.waitFor(() => expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null }), { timeout: 5_000 });
        await expect(client.getState()).resolves.toMatchObject({ isStreaming: false, hasPendingAsyncWork: true, isSettled: false });
        // A message sends right away while the job keeps running.
        await runtime.command({ type: "prompt", message: "Are you still there?" });
        await vi.waitFor(() => {
          expect(fixture.requests).toBe(3);
          expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
        }, { timeout: 15_000 });
        await expect(client.getState()).resolves.toMatchObject({ hasPendingAsyncWork: true });
      }
      const startsBeforeRelease = starts();
      await writeFile(path.join(root, "release-job"), "release");
      await vi.waitFor(async () => {
        await expect(client.getState()).resolves.toMatchObject({ hasPendingAsyncWork: false });
        if (action === "finish") expect(starts()).toBeGreaterThan(startsBeforeRelease);
        expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
      }, { timeout: 15_000 });
      expect(runtime.snapshot().error).toBeUndefined();
    } finally {
      // Release even on failure so no test-owned shell can outlive cleanup.
      releaseReply();
      await writeFile(path.join(root, "release-job"), "release");
      if (runtime) await runtime.stop();
      else await client.stop();
      await fixture.close();
    }
  }, 45_000);

  // can1357/oh-my-pi#14948: a failed todo call queues hidden next-turn
  // context, so native isSettled stays false after the session goes quiet.
  it("settles after a failed todo call leaves hidden next-turn context", async () => {
    const fixture = await startModelFixture((request) => request === 1
      ? toolCall("broken-todo", "todo", { ops: "not-a-list" })
      : { delta: { content: "Finished without todo progress." }, finish: "stop" });
    const client = startOmp({ transport: "local" }, {
      executable: process.env.OMP_COMMAND ?? "omp", cwd: fixture.root,
      env: { PI_CODING_AGENT_DIR: fixture.agentDirectory }, model: "fixture/fixture",
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-pty", "--no-title", "--tools", "todo"],
    });
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    let runtime: AgentSessionRuntime | undefined;
    try {
      const state = await client.getState();
      runtime = new AgentSessionRuntime("session", "connection", "workspace", ompProviderAdapter, client, {
        state, messages: [], models: [], commands: [], stats: await client.getSessionStats(),
      }, {}, async () => [], async () => {}, async () => {}, [], () => {});
      await runtime.command({ type: "prompt", message: "Use the todo fixture." });
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: "agent_end", isTerminal: true })), { timeout: 15_000 });
      await vi.waitFor(() => expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null }), { timeout: 5_000 });
      await expect(client.getState()).resolves.toMatchObject({
        isStreaming: false, hasPendingAsyncWork: false, isSettled: false, queuedMessageCount: 1,
        queuedMessages: { steering: [], followUp: [] },
      });
      expect(runtime.snapshot().error).toBeUndefined();
    } finally {
      if (runtime) await runtime.stop();
      else await client.stop();
      await fixture.close();
    }
  }, 30_000);
});
