import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";


import { startOmp } from "./client";
import { probeOmpConnection } from "./probe";
import { listOmpWorkspaceSessions } from "./sessions";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";
import { applyAgentRuntimeMessageEvent } from "@overtchat/agent-bridge";

const runIntegration = process.env.RUN_OMP_INTEGRATION === "1";
const executable = process.env.OMP_COMMAND ?? "omp";
const connectorId =
  process.env.OVERTCHAT_TEST_CONNECTOR_ID ??
  "11111111-1111-4111-8111-111111111111";

beforeAll(configureLocalTestProcessSpawner);

// Explicit opt-in: uses the host's configured model credentials to summarize
// synthetic history. Native session/config files belong only to this test.
describe.runIf(process.env.RUN_OMP_COMPACTION_INTEGRATION === "1")("installed OMP compaction", () => {
  it("compacts native history and leaves a completed display marker", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-omp-compaction-"));
    const sessionPath = path.join(root, "session.jsonl");
    const config = path.join(root, "config.yml");
    const probe = startOmp({ transport: "local" }, {
      executable, cwd: root, noSession: true,
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules", "--no-tools"],
    });
    let model: string;
    try {
      const state = await probe.getState();
      model = (state.model as { id: string }).id;
    } finally {
      await probe.stop();
    }
    const now = Date.now();
    const nativeMessages = [
      { role: "user", content: "Remember: the fictional project is called Atlas. " + "Synthetic context for compaction validation. ".repeat(1000), timestamp: now },
      { role: "assistant", content: [{ type: "text", text: "The project is Atlas." }], api: "openai-responses", provider: "openai", model: "fixture", stopReason: "stop", timestamp: now + 1,
        usage: { input: 6000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 6010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
      { role: "user", content: "Keep the project name for later.", timestamp: now + 2 },
    ];
    fs.writeFileSync(config, "compaction:\n  methodOrder: [soft]\n  keepRecentTokens: 128\n  reserveTokens: 1024\n");
    fs.writeFileSync(sessionPath, [
      { type: "session", version: 3, id: crypto.randomUUID(), timestamp: new Date(now).toISOString(), cwd: root },
      ...nativeMessages.map((message, i) => ({ type: "message", id: `entry-${i}`, parentId: i ? `entry-${i - 1}` : null, timestamp: new Date(now + i).toISOString(), message })),
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const client = startOmp({ transport: "local" }, {
      executable, cwd: root, sessionPath, model,
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules", "--no-tools", "--config", config],
    });
    let displayed: unknown[] = [...nativeMessages];
    client.onEvent((event) => { displayed = applyAgentRuntimeMessageEvent(displayed, event); });
    try {
      await client.getState();
      await client.compact("Keep the project name. This is synthetic test data; summarize briefly.");
      expect(displayed.slice(0, nativeMessages.length)).toEqual(nativeMessages);
      expect(displayed).toHaveLength(nativeMessages.length + 1);
      expect(displayed.at(-1)).toMatchObject({ role: "compactionSummary", status: "completed", trigger: "manual", tokensBefore: expect.any(Number) });
      const history = await client.getMessages();
      expect(history.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "compactionSummary" })]));
    } finally {
      await client.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});

describe.runIf(runIntegration)("installed Oh My Pi integration", () => {
  it(
    "probes OMP, controls a session, and discovers its native history",
    async () => {
      const probe = await probeOmpConnection({
        connectorId,
        provider: "omp",
        name: "Local Oh My Pi",
        transport: "local",
        executable,
      });
      expect(probe).toMatchObject({
        status: "ready",
        version: expect.stringMatching(/^\d+\.\d+\.\d+/u),
      });
      if (probe.status !== "ready") throw new Error("Expected a ready probe.");
      expect(probe.models.length).toBeGreaterThan(0);

      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "overtchat-omp-session-"),
      );
      const workspace = path.join(root, "workspace");
      const agentDirectory = path.join(root, "agent");
      fs.mkdirSync(workspace);
      fs.mkdirSync(agentDirectory);
      const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = agentDirectory;
      const client = startOmp(
        { transport: "local" },
        {
          executable,
          cwd: workspace,
          env: { PI_CODING_AGENT_DIR: agentDirectory },
          extraArgs: [
            "--no-extensions",
            "--no-skills",
            "--no-rules",
          ],
        },
      );
      const events: Array<Record<string, unknown>> = [];
      client.onEvent((event) => events.push(event));
      let nativeState: Record<string, unknown> | undefined;

      try {
        const state = await client.getState();
        nativeState = state;
        expect(state).toMatchObject({
          sessionId: expect.any(String),
          sessionFile: expect.any(String),
          isStreaming: false,
        });
        await client.setSessionName("OvertChat OMP integration");
        await expect(client.getCommands()).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "compact" }),
            expect.objectContaining({ name: "security" }),
          ]),
        );
        await client.prompt("/model");
        await vi.waitFor(() => {
          expect(events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "command_output",
                text: expect.any(String),
              }),
            ]),
          );
        });
        await expect(client.getMessages()).resolves.toEqual({ messages: [] });
      } finally {
        await client.stop();
      }

      try {
        if (
          typeof nativeState?.sessionFile !== "string" ||
          typeof nativeState.sessionId !== "string"
        ) {
          throw new Error("OMP did not return native session metadata.");
        }
        // OMP defers creating an empty session file until the first model turn.
        // Materialize the native two-line header to exercise remote discovery
        // without spending provider tokens in this integration test.
        fs.mkdirSync(path.dirname(nativeState.sessionFile), {
          recursive: true,
        });
        fs.writeFileSync(
          nativeState.sessionFile,
          [
            JSON.stringify({
              type: "title",
              v: 1,
              title: "OvertChat OMP integration",
              updatedAt: new Date().toISOString(),
            }),
            JSON.stringify({
              type: "session",
              version: 3,
              id: nativeState.sessionId,
              timestamp: new Date().toISOString(),
              cwd: workspace,
            }),
            "",
          ].join("\n"),
        );
        await expect(
          listOmpWorkspaceSessions(
            { transport: "local" },
            workspace,
          ),
        ).resolves.toEqual([
          expect.objectContaining({
            name: "OvertChat OMP integration",
            messageCount: 0,
          }),
        ]);
      } finally {
        if (previousAgentDirectory === undefined) {
          delete process.env.PI_CODING_AGENT_DIR;
        } else {
          process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
