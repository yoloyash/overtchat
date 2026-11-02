import { beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AgentRuntimeRegistry } from "../runtime/registry";
import { startOmp } from "./client";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

const executable = process.env.OMP_COMMAND ?? "omp";
beforeAll(configureLocalTestProcessSpawner);

describe.runIf(process.env.RUN_OMP_COMPACTION_INTEGRATION === "1")("installed OMP: queue during manual compaction", () => {
  it("acknowledges /compact at start, holds the queued prompt, and delivers it after", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-omp-compact-queue-"));
    const sessionPath = path.join(root, "session.jsonl");
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    const filler = (index: number) => `Note ${index}: synthetic context for compaction validation. `.repeat(1500);
    const nativeMessages = [
      ...[0, 1, 2, 3, 4, 5].flatMap((index) => [
        { role: "user", content: `Remember: the fictional project is called Atlas. ${filler(index)}`, timestamp: now + index * 2 },
        { role: "assistant", content: [{ type: "text", text: "The project is Atlas." }], api: "openai-responses", provider: "openai", model: "fixture", stopReason: "stop", timestamp: now + index * 2 + 1,
          usage: { input: 15000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 15010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
      ]),
      { role: "user", content: "Keep the project name for later.", timestamp: now + 20 },
    ];
    fs.writeFileSync(sessionPath, [
      { type: "session", version: 3, id: sessionId, timestamp: new Date(now).toISOString(), cwd: root },
      ...nativeMessages.map((message, i) => ({ type: "message", id: `entry-${i}`, parentId: i ? `entry-${i - 1}` : null, timestamp: new Date(now + i).toISOString(), message })),
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    const probe = startOmp({ transport: "local" }, {
      executable, cwd: root, noSession: true,
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules", "--no-tools"],
    });
    let model: string;
    try {
      const state = await probe.getState();
      model = (state.model as { id: string }).id;
      console.log("probe model", JSON.stringify(state.model));
    } finally {
      await probe.stop();
    }
    const registry = new AgentRuntimeRegistry({ resolveImages: async () => [] });
    const log: string[] = [];
    const stamp = (line: string) => log.push(`${((Date.now() - now) / 1000).toFixed(1)}s ${line}`);
    try {
      const runtime = await registry.getOrStart({
        connectionId: "connection", workspaceId: "workspace", provider: "omp",
        target: { transport: "local" }, executable, cwd: root, sessionId: "session",
        providerSessionId: sessionId, providerSessionPath: sessionPath, launchConfig: { model },
      });
      runtime.subscribe((envelope) => {
        const data = (envelope as { data?: { type?: string; status?: string; message?: { role?: string; status?: string } } }).data;
        if (envelope.type !== "runtime_event" || !data) return;
        if (data.type === "compaction_start" || data.type === "compaction_end" || data.type === "rpc_error" || data.type === "overtchat_status" || data.type === "overtchat_queue_update")
          stamp(`${data.type} ${data.status ?? ""} ${(data as { error?: string }).error ?? ""} ${(data as { errorMessage?: string }).errorMessage ?? ""}`);
        if (data.type === "message_end" && data.message?.role === "compactionSummary") stamp(`compactionSummary ${data.message.status}`);
      });
      stamp(`started status=${runtime.snapshot().status}`);

      const compactSent = Date.now();
      await runtime.command({ type: "compact", customInstructions: "Keep the project name. Synthetic test data; summarize briefly." });
      const compactAckMs = Date.now() - compactSent;
      const afterAck = runtime.snapshot();
      stamp(`compact acknowledged after ${compactAckMs}ms status=${afterAck.status} isCompacting=${String(afterAck.state.isCompacting)}`);
      expect(afterAck).toMatchObject({ status: "running", state: { isCompacting: true } });

      await runtime.command({ type: "queue", message: "Reply with exactly the two words: QUEUED OK" }, "queued-after-compaction");
      const afterQueue = runtime.snapshot();
      stamp(`queued status=${afterQueue.status} isCompacting=${String(afterQueue.state.isCompacting)} queue=${JSON.stringify(afterQueue.queuedMessages.map((m) => m.status))}`);
      expect(afterQueue.queuedMessages).toMatchObject([{ id: "queued-after-compaction", status: "pending" }]);

      const deadline = Date.now() + 170_000;
      while (Date.now() < deadline) {
        const snapshot = runtime.snapshot();
        const answered = snapshot.messages.some((message) => {
          const row = message as { role?: string; content?: unknown };
          return row.role === "assistant" && JSON.stringify(row.content ?? "").includes("QUEUED OK");
        });
        if (snapshot.status === "idle" && snapshot.queuedMessages.length === 0 && snapshot.state.isCompacting !== true && answered) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const final = runtime.snapshot();
      stamp(`final status=${final.status} isCompacting=${String(final.state.isCompacting)} queue=${final.queuedMessages.length} error=${final.error ?? "none"}`);
      const summaryIndex = final.messages.findIndex((message) => (message as { role?: string }).role === "compactionSummary");
      const answerIndex = final.messages.findIndex((message) => {
        const row = message as { role?: string; content?: unknown };
        return row.role === "assistant" && JSON.stringify(row.content ?? "").includes("QUEUED OK");
      });
      stamp(`compactionSummary index=${summaryIndex} answer index=${answerIndex} of ${final.messages.length}`);
      console.log(log.join("\n"));
      expect(final).toMatchObject({ status: "idle", queuedMessages: [] });
      expect(final.messages[summaryIndex]).toMatchObject({ role: "compactionSummary", status: "completed", trigger: "manual" });
      expect(answerIndex).toBeGreaterThan(summaryIndex);
      expect(compactAckMs).toBeLessThan(5_000);
    } finally {
      await registry.stopAll();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 200_000);
});
