import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configureProcessSpawner } from "@overtchat/agent-runtime";
import { ClaudeRuntimeClient } from "@overtchat/agent-runtime/claude/client";
import { ConnectorProcessHost } from "./runtime.js";

// Opt-in: uses the installed/authenticated Claude CLI and one small model turn
// in a disposable workspace. It never opens an existing user conversation.
it.runIf(process.env.RUN_CLAUDE_CONTEXT_INTEGRATION === "1")(
  "reads native context before a prompt and after stopping/resuming the real CLI",
  async () => {
    const host = new ConnectorProcessHost();
    configureProcessSpawner(host.spawn);
    const cwd = await realpath(await mkdtemp(join(tmpdir(), "overtchat-context-live-")));
    const launch = { executable: process.env.CLAUDE_COMMAND ?? "claude", cwd, modeId: "default",
      ...(process.env.CLAUDE_CONTEXT_MODEL ? { model: process.env.CLAUDE_CONTEXT_MODEL } : {}),
    };
    let client = new ClaudeRuntimeClient({ transport: "local" }, launch);
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const opened = (await client.getSessionStats()).contextUsage;
      expect(opened?.tokens).toBeGreaterThan(0);
      expect(opened?.contextWindow).toBeGreaterThan(0);
      const completion = new Promise<void>((resolve, reject) => {
        completionTimer = setTimeout(() => reject(new Error("Claude did not complete the test prompt within 60 seconds")), 60_000);
        const unsubscribe = client.onEvent((event) => {
          if (event.type === "turn_end") { unsubscribe(); resolve(); }
          if (event.type === "rpc_error" || event.type === "process_exit") {
            unsubscribe(); reject(new Error("Claude live context turn failed"));
          }
        });
      });
      await client.prompt("This is an OvertChat context-meter integration test. Reply with exactly OK. Do not use tools.");
      await completion;
      const state = await client.getState();
      const completed = (await client.getSessionStats()).contextUsage;
      expect(completed?.tokens).toBeGreaterThan(0);
      await client.stop();
      client = new ClaudeRuntimeClient({ transport: "local" }, { ...launch, resume: {
        providerSessionId: state.sessionId as string,
        providerSessionPath: state.sessionFile as string,
      } });
      const resumed = (await client.getSessionStats()).contextUsage;
      expect(resumed?.tokens).toBeGreaterThan(0);
      expect(resumed?.contextWindow).toBe(completed?.contextWindow);
      expect(resumed?.percent).toBeLessThan(100);
      expect((await client.getMessages()).messages.length).toBeGreaterThanOrEqual(2);
      // Only numeric usage metadata is logged, never prompts/settings/credentials.
      console.info("Claude context live readings", { opened, completed, resumed });
    } finally {
      clearTimeout(completionTimer);
      await client.stop();
      await host.stop();
      await rm(cwd, { recursive: true, force: true });
    }
  },
  120_000,
);
