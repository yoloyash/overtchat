import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deleteOpenCodeSession,
  startOpenCodeRuntime,
} from "./client";
import { probeOpenCodeTarget } from "./probe";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

const runIntegration = process.env.RUN_OPENCODE_INTEGRATION === "1";
const executable = process.env.OPENCODE_COMMAND ?? "opencode";

beforeAll(configureLocalTestProcessSpawner);

function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        if (await condition()) {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error("Timed out waiting for OpenCode integration state."));
          return;
        }
        setTimeout(check, 100).unref();
      } catch (error) {
        reject(error);
      }
    };
    void check();
  });
}

function messageText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const content = Reflect.get(value, "content");
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      part && typeof part === "object" && typeof Reflect.get(part, "text") === "string"
        ? [Reflect.get(part, "text") as string]
        : [],
    )
    .join("\n");
}

describe.runIf(runIntegration)("installed OpenCode integration", () => {
  it(
    "streams, steers, aborts, and resumes a disposable native session",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-opencode-"));
      const target = { transport: "local" as const };
      let sessionId: string | undefined;
      const probe = await probeOpenCodeTarget(target, executable);
      expect(probe).toMatchObject({
        status: "ready",
        version: expect.stringMatching(/^\d+\.\d+\.\d+/u),
      });
      expect(probe.models).not.toHaveLength(0);
      let client = startOpenCodeRuntime(target, {
        executable,
        cwd: root,
      });
      const events: Array<Record<string, unknown>> = [];
      client.onEvent((event) => {
        events.push(event);
        if (event.type === "interaction_request" && typeof event.id === "string") {
          client.respondToInteraction(event.id, { value: "Allow once" });
        }
      });

      try {
        const state = await client.getState();
        sessionId = state.sessionId as string;
        expect(sessionId).toMatch(/^ses_/u);
        const models = await client.getAvailableModels();
        expect(models).not.toHaveLength(0);
        expect(await client.getCommands()).toEqual(expect.any(Array));
        const selectedModel =
          models.find((model) => model.id === (state.model as { id?: string } | null)?.id) ??
          models[0];
        await client.setModel(selectedModel!.id);
        const selectedVariant =
          selectedModel!.thinkingOptions?.find((option) => option.id !== "default")?.id ??
          selectedModel!.defaultThinkingOptionId ??
          "default";
        await client.setThinkingLevel(selectedVariant);
        const modes = Array.isArray(state.modes) ? state.modes : [];
        const selectedMode = modes.find(
          (mode) => mode && typeof mode === "object" && typeof Reflect.get(mode, "id") === "string",
        );
        if (selectedMode) await client.setMode(Reflect.get(selectedMode, "id") as string);
        await expect(client.getState()).resolves.toMatchObject({
          model: { provider: "opencode", id: selectedModel!.id },
          thinkingLevel: selectedVariant,
        });
        await client.setSessionName("OvertChat OpenCode integration");

        await client.prompt(
          "Use the shell to run `sleep 3`, then reply with the exact text FIRST_RESPONSE.",
          [],
          { clientMessageId: "integration-first" },
        );
        await waitUntil(() => events.some((event) => event.type === "turn_start"));
        await client.steer(
          "Change course: reply with the exact text OPENCODE_STEER_OK instead.",
          [],
          { clientMessageId: "integration-steer" },
        );
        await waitUntil(async () => {
          const current = await client.getState();
          const history = await client.getMessages();
          return (
            current.isStreaming === false &&
            history.messages.some((message) =>
              messageText(message).includes("OPENCODE_STEER_OK"),
            )
          );
        });

        const streamed = await client.getMessages();
        expect(streamed.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              overtchatSubmissionId: "integration-first",
            }),
            expect.objectContaining({
              role: "user",
              overtchatSubmissionId: "integration-steer",
            }),
          ]),
        );
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "message_update" }),
            expect.objectContaining({ type: "tool_execution_end" }),
            expect.objectContaining({ type: "turn_end" }),
          ]),
        );

        const startedCount = events.filter((event) => event.type === "turn_start").length;
        await client.prompt("Use the shell to run `sleep 10`, then say TOO_LATE.");
        await waitUntil(
          () => events.filter((event) => event.type === "turn_start").length > startedCount,
        );
        await client.abort();
        await waitUntil(async () => (await client.getState()).isStreaming === false);

        await client.stop();
        client = startOpenCodeRuntime(target, {
          executable,
          cwd: root,
          resumeSessionId: sessionId,
        });
        await expect(client.getState()).resolves.toMatchObject({
          sessionId,
          sessionName: "OvertChat OpenCode integration",
        });
        const resumed = await client.getMessages();
        expect(resumed.messages.some((message) => messageText(message).includes("OPENCODE_STEER_OK"))).toBe(true);
      } finally {
        await client.stop();
        if (sessionId) {
          await deleteOpenCodeSession(target, executable, root, sessionId).catch(() => {});
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
