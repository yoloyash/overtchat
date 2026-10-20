import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAgentRuntimeEnvelope } from "@overtchat/agent-bridge";
import {
  configureProcessSpawner,
  configureManagedProcessSpawner,
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime";
import { startHermesRuntime } from "@overtchat/agent-runtime/hermes/client";
import { listHermesSessions } from "@overtchat/agent-runtime/hermes/sessions";
import { AgentRuntimeRegistry } from "@overtchat/agent-runtime/runtime/registry";
import { ConnectorProcessHost } from "./runtime.js";

const enabled = process.env.RUN_HERMES_INTEGRATION === "1";
const target: HostTarget = process.env.HERMES_SSH_ALIAS
  ? { transport: "ssh", alias: process.env.HERMES_SSH_ALIAS }
  : { transport: "local" };

describe.runIf(enabled)("Hermes ACP on the execution host", () => {
  it("discovers models, restarts a running turn for steering, persists and reloads history", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "overtchat-hermes-processes-"),
    );
    const host = new ConnectorProcessHost(directory);
    configureProcessSpawner(host.spawn);
    configureManagedProcessSpawner(host.spawnManaged);
    const executable = process.env.HERMES_COMMAND ?? "hermes";
    const cwd = (
      await executeOnHost(target, {
        command: "mktemp",
        args: ["-d", "/tmp/overtchat-hermes-test.XXXXXX"],
      })
    ).stdout.trim();
    const clients: ReturnType<typeof startHermesRuntime>[] = [];
    const registry = new AgentRuntimeRegistry({
      resolveImages: async () => [],
    });
    let sessionId: string | undefined;
    try {
      const { runtime, session } = await registry.create(
        "hermes-live-smoke",
        {
          connectionId: "test",
          workspaceId: "test",
          provider: "hermes",
          target,
          executable,
          cwd,
        },
        { modeId: "dont_ask" },
      );
      sessionId = session.providerSessionId;
      expect(runtime.snapshot().models).not.toHaveLength(0);
      expect(runtime.snapshot().commands).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "version" })]),
      );
      expect(
        (await listHermesSessions(target, executable, cwd)).some(
          (s) => s.providerSessionId === sessionId,
        ),
      ).toBe(false);
      let resolveToolStarted!: () => void;
      const toolStarted = new Promise<void>((resolve) => {
        resolveToolStarted = resolve;
      });
      let completedTurns = 0;
      const ended = new Promise<void>((resolve, reject) =>
        runtime.subscribe((envelope) => {
          if (!isAgentRuntimeEnvelope(envelope))
            reject(new Error("Invalid bridge envelope."));
          if (envelope.type !== "runtime_event") return;
          const event = envelope.data;
          if (event.type === "turn_end" && ++completedTurns === 2) resolve();
          if (
            event.type === "overtchat_turn_update" &&
            JSON.stringify(event.messages).includes('"toolCall"')
          )
            resolveToolStarted();
          if (event.type === "rpc_error" || event.type === "process_exit")
            reject(new Error(String(event.error)));
        }),
      );
      // Only this disposable session gets automatic approval for its harmless sleep tool.
      await runtime.command(
        {
          type: "prompt",
          message:
            "Call the terminal tool to run `sleep 5` in the current directory, then reply with exactly HERMES_ORIGINAL. Do not use background execution. Do not do any other work.",
        },
        "hermes-live-smoke",
      );
      await Promise.race([
        toolStarted,
        ended.then(() => {
          throw new Error("Hermes finished without calling the test tool");
        }),
      ]);
      await runtime.command(
        {
          type: "queue",
          message:
            "Change the final reply to exactly HERMES_OVERTCHAT_STEER_OK instead of HERMES_ORIGINAL. Do not do any other work.",
        },
        "hermes-live-steer",
      );
      await runtime.command({
        type: "steer_queued_message",
        id: "hermes-live-steer",
      });
      expect(runtime.snapshot().status).toBe("running");
      expect(runtime.snapshot().queuedMessages).toEqual([]);
      await ended;
      const before = runtime.snapshot();
      const assistantText = before.messages.filter(
        (m) => Reflect.get(m as object, "role") === "assistant",
      );
      expect(JSON.stringify(assistantText)).toContain(
        "HERMES_OVERTCHAT_STEER_OK",
      );
      expect(JSON.stringify(assistantText)).not.toContain(
        "Steer queued for the active turn",
      );
      expect(
        before.messages.filter(
          (m) => Reflect.get(m as object, "role") === "user",
        ),
      ).toHaveLength(2);
      await registry.stopAll();
      const sessions = await listHermesSessions(target, executable, cwd);
      expect(sessions.some((s) => s.providerSessionId === sessionId)).toBe(
        true,
      );
      const resumed = startHermesRuntime(target, {
        executable,
        cwd,
        resume: {
          providerSessionId: sessionId,
          providerSessionPath: sessionId,
        },
      });
      clients.push(resumed);
      const events: string[] = [];
      resumed.onEvent((event) => events.push(event.type));
      expect((await resumed.getState()).sessionId).toBe(sessionId);
      expect(events).not.toContain("turn_start");
      const history = (await resumed.getMessages()).messages;
      expect(
        history.filter((m) => Reflect.get(m as object, "role") === "user"),
      ).toHaveLength(2);
      expect(JSON.stringify(history)).toContain("HERMES_OVERTCHAT_STEER_OK");
      expect(JSON.stringify(history)).not.toContain("OUT-OF-BAND USER MESSAGE");
    } finally {
      await registry.stopAll();
      for (const client of clients) await client.stop();
      if (sessionId)
        await executeOnHost(target, {
          command: executable,
          args: ["sessions", "delete", sessionId, "--yes"],
        });
      await executeOnHost(target, { command: "rm", args: ["-rf", "--", cwd] });
      await host.stop();
      expect(await readdir(directory)).toEqual([]);
      await rm(directory, { recursive: true });
    }
  }, 180_000);
});
