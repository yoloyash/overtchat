import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyAgentRuntimeMessageEvent } from "@overtchat/agent-bridge";
import { latestAgentTaskList, projectAgentTranscript } from "@overtchat/shared/agent-presentation";
import { startOmp } from "./client";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

beforeAll(configureLocalTestProcessSpawner);

// Opt-in: a small model turn using local credentials; only the disposable
// session's todo tool is enabled. No existing sessions or settings are changed.
describe.runIf(process.env.RUN_OMP_TODO_INTEGRATION === "1")("installed OMP todos", () => {
  it("streams native todo progress and restores it after provider restart", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-omp-todos-"));
    const launch = {
      executable: process.env.OMP_COMMAND ?? "omp", cwd: root,
      sessionPath: path.join(root, "session.jsonl"),
      ...(process.env.OMP_MODEL ? { model: process.env.OMP_MODEL } : {}),
      extraArgs: ["--no-extensions", "--no-skills", "--no-rules", "--tools", "todo"],
    };
    fs.writeFileSync(launch.sessionPath, JSON.stringify({
      type: "session", version: 3, id: crypto.randomUUID(), timestamp: new Date().toISOString(), cwd: root,
    }) + "\n");
    let client = startOmp({ transport: "local" }, launch);
    let messages: unknown[] = [];
    let settled = false;
    const completedCounts: number[] = [];
    client.onEvent((event) => {
      messages = applyAgentRuntimeMessageEvent(messages, event);
      const tasks = latestAgentTaskList(messages);
      if (tasks) completedCounts.push(tasks.tasks.filter((task) => task.status === "completed").length);
      if (event.type === "agent_end") settled = true;
    });
    try {
      await client.getState();
      await client.prompt('This is a todo UI integration test. Use the todo tool to create exactly two tasks named "Inspect fixture" and "Verify fixture". Then mark each completed with separate todo calls. These are fictional tasks; do not perform actual work or use other tools. Finish with "TODO_TEST_COMPLETE".');
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 150_000, interval: 100 });
      const tasks = latestAgentTaskList(messages);
      expect(tasks?.tasks.map((task) => task.step)).toEqual(["Inspect fixture", "Verify fixture"]);
      expect(tasks?.tasks.every((task) => task.status === "completed")).toBe(true);
      expect(completedCounts).toContain(0);
      expect(completedCounts).toContain(1);
      expect(projectAgentTranscript(messages).some((item) => item.type === "task_list")).toBe(true);
      await client.stop();
      client = startOmp({ transport: "local" }, launch);
      const restored = await client.getMessages();
      expect(latestAgentTaskList(restored.messages)?.tasks).toEqual(tasks?.tasks);
    } finally {
      await client.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
