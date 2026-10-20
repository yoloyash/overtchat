import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ClaudeRuntimeClient } from "./client";
import { claudeProviderAdapter } from "../providers/claude";
import { AgentSessionRuntime } from "../runtime/registry";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

beforeAll(configureLocalTestProcessSpawner);

// Opt-in: uses the installed Claude CLI and its configured model credentials.
// Each case owns a new native session and a disposable workspace.
describe.runIf(process.env.RUN_CLAUDE_BACKGROUND_INTEGRATION === "1")("installed Claude background activity", () => {
  it.each(["bash", "subagent"] as const)("tracks %s work through parent yield and autonomous wake", async (kind) => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "overtchat-claude-background-"));
    const releaseFile = path.join(cwd, "release-job");
    const client = new ClaudeRuntimeClient({ transport: "local" }, {
      executable: process.env.CLAUDE_COMMAND ?? "claude", cwd,
      ...(process.env.CLAUDE_BACKGROUND_MODEL ? { model: process.env.CLAUDE_BACKGROUND_MODEL } : {}),
      modeId: "bypassPermissions",
    });
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    let runtime: AgentSessionRuntime | undefined;
    try {
      runtime = new AgentSessionRuntime("session", "connection", "workspace", claudeProviderAdapter, client, {
        state: await client.getState(), messages: [], models: [], commands: [], stats: await client.getSessionStats(),
      }, {}, async () => [], async () => {}, async () => {}, [], () => {});
      const command = `while [ ! -f '${releaseFile}' ]; do sleep 0.1; done; echo BACKGROUND_DONE`;
      const task = kind === "bash"
        ? `Use Bash to run this exact command with run_in_background=true: ${command}`
        : `Launch exactly one general-purpose Agent with run_in_background=true. Instruct it to use Bash to run this exact command in the foreground: ${command}. After that command finishes, it must reply BACKGROUND_DONE and stop.`;
      await runtime.command({ type: "prompt", message:
        `This is an isolated lifecycle integration test. ${task}\n` +
        "Immediately after launching it, reply STARTED and end your turn. Do not wait, poll TaskOutput, read the output file, or create release-job. " +
        "The test harness will release the job after observing your idle parent turn. When notified of completion, reply WAKE_DONE and end your turn. Do nothing else.",
      });
      // Yielding to the job ends the parent turn; the job keeps running.
      await vi.waitFor(() => {
        expect(events).toContainEqual(expect.objectContaining({ type: "turn_end" }));
        expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
      }, { timeout: 90_000, interval: 100 });
      expect(await client.getState()).toMatchObject({ isStreaming: false, hasPendingAsyncWork: true });
      await runtime.refreshState();
      expect(runtime.snapshot().status).toBe("idle");
      const startsBeforeRelease = events.filter((event) => event.type === "turn_start").length;
      await writeFile(releaseFile, "release");
      await vi.waitFor(() => {
        expect(events.filter((event) => event.type === "turn_start").length).toBeGreaterThan(startsBeforeRelease);
        expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
        expect(runtime!.snapshot().error).toBeUndefined();
      }, { timeout: 90_000, interval: 100 });
      expect(await client.getState()).toMatchObject({ isStreaming: false, hasPendingAsyncWork: false });
    } finally {
      // Release the test-owned job even when an assertion fails.
      await writeFile(releaseFile, "release");
      if (runtime) await runtime.stop();
      else await client.stop();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 210_000);

  it("stops the parent turn and keeps its background job running", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "overtchat-claude-stop-"));
    const releaseFile = path.join(cwd, "release-job");
    const client = new ClaudeRuntimeClient({ transport: "local" }, {
      executable: process.env.CLAUDE_COMMAND ?? "claude", cwd,
      ...(process.env.CLAUDE_BACKGROUND_MODEL ? { model: process.env.CLAUDE_BACKGROUND_MODEL } : {}),
      modeId: "bypassPermissions",
    });
    let runtime: AgentSessionRuntime | undefined;
    try {
      runtime = new AgentSessionRuntime("session", "connection", "workspace", claudeProviderAdapter, client, {
        state: await client.getState(), messages: [], models: [], commands: [], stats: await client.getSessionStats(),
      }, {}, async () => [], async () => {}, async () => {}, [], () => {});
      const command = `while [ ! -f '${releaseFile}' ]; do sleep 0.1; done; echo BACKGROUND_DONE`;
      await runtime.command({ type: "prompt", message:
        `This is an isolated lifecycle integration test. First use Bash to run this exact command with run_in_background=true: ${command}\n` +
        "Then use Bash in the foreground, without run_in_background, to run exactly: sleep 120\n" +
        "Do not create release-job, poll TaskOutput, or read the output file. Do nothing else.",
      });
      await vi.waitFor(async () => {
        expect(await client.getState()).toMatchObject({ isStreaming: true, hasPendingAsyncWork: true });
        expect(runtime!.snapshot().status).toBe("running");
      }, { timeout: 90_000, interval: 100 });
      await runtime.command({ type: "abort" });
      await vi.waitFor(() => expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null }), { timeout: 15_000 });
      // A restarted query would have dropped the task roster.
      expect(await client.getState()).toMatchObject({ isStreaming: false, hasPendingAsyncWork: true });
      await writeFile(releaseFile, "release");
      await vi.waitFor(async () => {
        expect(await client.getState()).toMatchObject({ hasPendingAsyncWork: false });
        expect(runtime!.snapshot()).toMatchObject({ status: "idle", activeTurn: null });
      }, { timeout: 90_000, interval: 100 });
    } finally {
      await writeFile(releaseFile, "release");
      if (runtime) await runtime.stop();
      else await client.stop();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 210_000);
});
