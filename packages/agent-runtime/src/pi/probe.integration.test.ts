import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";


import { startPi } from "./client";
import { probePiConnection } from "./probe";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

const runIntegration = process.env.RUN_PI_INTEGRATION === "1";
const connectorId =
  process.env.OVERTCHAT_TEST_CONNECTOR_ID ??
  "11111111-1111-4111-8111-111111111111";
const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

beforeAll(configureLocalTestProcessSpawner);

describe.runIf(runIntegration)("installed Pi integration", () => {
  it(
    "starts RPC mode and discovers usable models",
    async () => {
      const probe = await probePiConnection({
        connectorId,
        provider: "pi",
        name: "Local Pi",
        transport: "local",
        executable: process.env.PI_COMMAND ?? "pi",
      });

      expect(probe.status).toBe("ready");
      if (probe.status !== "ready") throw new Error("Expected a ready probe.");
      expect(probe.version).toMatch(/^\d+\.\d+\.\d+/u);
      expect(probe.models.length).toBeGreaterThan(0);
      expect(probe.models[0]).toMatchObject({
        provider: expect.any(String),
        id: expect.any(String),
        contextWindow: expect.any(Number),
        cost: {
          input: expect.any(Number),
          output: expect.any(Number),
        },
      });
    },
    150_000,
  );

  it(
    "opens and controls a native persistent session without a model turn",
    async () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "overtchat-pi-session-"),
      );
      const workspace = path.join(root, "workspace");
      const sessions = path.join(root, "sessions");
      fs.mkdirSync(workspace);
      fs.mkdirSync(sessions);
      const client = startPi(
        { transport: "local" },
        {
          executable: process.env.PI_COMMAND ?? "pi",
          cwd: workspace,
          env: { PI_CODING_AGENT_SESSION_DIR: sessions },
          extraArgs: [
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-context-files",
          ],
        },
      );

      try {
        const state = await client.getState();
        expect(state).toMatchObject({
          sessionId: expect.any(String),
          sessionFile: expect.any(String),
          isStreaming: false,
        });
        await client.setSessionName("OvertChat integration");
        await expect(client.getState()).resolves.toMatchObject({
          sessionName: "OvertChat integration",
        });
        await expect(client.getMessages()).resolves.toEqual({ messages: [] });
        await expect(client.getSessionStats()).resolves.toMatchObject({
          sessionId: state.sessionId,
          totalMessages: 0,
          cost: 0,
        });
      } finally {
        await client.stop();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    "discovers every remote command kind and executes an extension command",
    async () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "overtchat-pi-commands-"),
      );
      const workspace = path.join(root, "workspace");
      fs.mkdirSync(workspace);
      const client = startPi(
        { transport: "local" },
        {
          executable: process.env.PI_COMMAND ?? "pi",
          cwd: workspace,
          noSession: true,
          extraArgs: [
            "--no-extensions",
            "--extension",
            path.join(fixtureDirectory, "rpc-command.js"),
            "--no-prompt-templates",
            "--prompt-template",
            path.join(fixtureDirectory, "overtchat-test-prompt.md"),
            "--no-skills",
            "--skill",
            path.join(
              fixtureDirectory,
              "overtchat-test-skill",
              "SKILL.md",
            ),
            "--no-context-files",
          ],
        },
      );

      try {
        await expect(client.getCommands()).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "overtchat-test-name",
              source: "extension",
            }),
            expect.objectContaining({
              name: "overtchat-test-prompt",
              source: "prompt",
            }),
            expect.objectContaining({
              name: "skill:overtchat-test-skill",
              source: "skill",
            }),
          ]),
        );

        await client.prompt("/overtchat-test-name Slash commands work");

        await expect(client.getState()).resolves.toMatchObject({
          sessionName: "Slash commands work",
          messageCount: 0,
          isStreaming: false,
        });
        await expect(client.getMessages()).resolves.toEqual({ messages: [] });
        await expect(client.getSessionStats()).resolves.toMatchObject({
          totalMessages: 0,
          cost: 0,
        });
      } finally {
        await client.stop();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
