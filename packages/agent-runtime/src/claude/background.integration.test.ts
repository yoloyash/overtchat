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
      await vi.waitFor(() => expect(runtime!.snapshot()).toMatchObject({
        status: "running", activeTurn: { phase: "waiting" },
      }), { timeout: 90_000, interval: 100 });
      expect(await client.getState()).toMatchObject({ isStreaming: false, hasPendingAsyncWork: true });
      await runtime.refreshState();
      expect(runtime.snapshot().activeTurn?.phase).toBe("waiting");
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
});
