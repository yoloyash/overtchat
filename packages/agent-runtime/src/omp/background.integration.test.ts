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

// Real OMP and bash, with an isolated profile and a loopback model fixture.
// No configured model credentials or existing native sessions are used.
describe.runIf(process.env.RUN_OMP_BACKGROUND_INTEGRATION === "1")("installed OMP background work", () => {
  it.each(["finish", "abort"] as const)("handles a real async bash job: %s", async (action) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "overtchat-omp-background-"));
    const agentDirectory = path.join(root, "agent");
    await mkdir(agentDirectory);
    let requests = 0;
    const server = createServer(async (request, response) => {
      for await (const _ of request) { /* Drain the model request. */ }
      const first = ++requests === 1;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        response.write(`data: ${JSON.stringify({ id: `reply-${requests}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      chunk({ role: "assistant" });
      chunk(first ? { tool_calls: [{ index: 0, id: "background-bash", type: "function", function: {
        name: "bash", arguments: JSON.stringify({ command: "while [ ! -f release-job ]; do sleep 0.1; done; echo BACKGROUND_DONE", timeout: 20, async: true }),
      } }] } : { content: requests === 2 ? "Answer finished; background work continues." : "Background result received." });
      chunk({}, first ? "tool_calls" : "stop");
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing model fixture port");
    await writeFile(path.join(agentDirectory, "models.yml"), JSON.stringify({ providers: {
      fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, auth: "none", api: "openai-completions", models: [
        { id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096 },
      ] },
    } }));
    const client = startOmp({ transport: "local" }, {
      executable: process.env.OMP_COMMAND ?? "omp", cwd: root,
      env: { PI_CODING_AGENT_DIR: agentDirectory }, model: "fixture/fixture",
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-pty", "--no-title", "--tools", "bash"],
    });
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    let runtime: AgentSessionRuntime | undefined;
    try {
      const state = await client.getState();
      runtime = new AgentSessionRuntime("session", "connection", "workspace", ompProviderAdapter, client, {
        state, messages: [], models: [], commands: [], stats: await client.getSessionStats(),
      }, {}, async () => [], async () => {}, async () => {}, [], () => {});
      await runtime.command({ type: "prompt", message: "Start the background fixture." });
      await vi.waitFor(() => expect(runtime!.snapshot().activeTurn?.phase).toBe("waiting"), { timeout: 15_000 });
      expect(events).toContainEqual(expect.objectContaining({ type: "agent_end", yielded: true, isTerminal: false, awaitingAsyncWork: true }));
      await expect(client.getState()).resolves.toMatchObject({ isStreaming: false, hasPendingAsyncWork: true, isSettled: false });
      await runtime.refreshState();
      expect(runtime.snapshot()).toMatchObject({ status: "running", activeTurn: { phase: "waiting" } });
      if (action === "abort") {
        await runtime.command({ type: "abort" });
        // OMP's native abort interrupts the foreground, not async bash jobs.
        await expect(client.getState()).resolves.toMatchObject({
          isStreaming: false, hasPendingAsyncWork: true, isSettled: false,
        });
        expect(runtime.snapshot()).toMatchObject({ status: "running", activeTurn: { phase: "waiting" } });
      }
      await writeFile(path.join(root, "release-job"), "release");
      await vi.waitFor(() => expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null }), { timeout: 15_000 });
      if (action === "finish") {
        expect(events.filter((event) => event.type === "agent_start").length).toBeGreaterThanOrEqual(2);
        expect(events).toContainEqual(expect.objectContaining({ type: "session_settled" }));
        expect(requests).toBeGreaterThanOrEqual(3);
      }
    } finally {
      // Release even on failure so no test-owned shell can outlive cleanup.
      await writeFile(path.join(root, "release-job"), "release");
      if (runtime) await runtime.stop();
      else await client.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);
});
