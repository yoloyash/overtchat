import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AgentRuntimeRegistry, type AgentSessionRuntime } from "../runtime/registry";
import { startOmp } from "./client";
import { listOmpWorkspaceSessions } from "./sessions";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

const executable = process.env.OMP_COMMAND ?? "omp";
const originalSessionDir = process.env.OMP_SESSION_DIR;
beforeAll(configureLocalTestProcessSpawner);
afterEach(() => {
  if (originalSessionDir === undefined) delete process.env.OMP_SESSION_DIR;
  else process.env.OMP_SESSION_DIR = originalSessionDir;
});

async function reply(runtime: AgentSessionRuntime, word: string): Promise<void> {
  await runtime.command({ type: "queue", message: `Reply with exactly the one word: ${word}` }, `ask-${word}`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const snapshot = runtime.snapshot();
    const answered = snapshot.messages.some((message) => {
      const row = message as { role?: string; content?: unknown };
      return row.role === "assistant" && JSON.stringify(row.content ?? "").includes(word);
    });
    if (snapshot.status === "idle" && snapshot.queuedMessages.length === 0 && answered) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Oh My Pi did not answer ${word}: ${runtime.snapshot().error ?? "no error"}`);
}

// Explicit opt-in: uses the host's configured model credentials for three
// one-word replies. Needs an OMP that keeps one writer per session (18.13+).
describe.runIf(process.env.RUN_OMP_MOVED_SESSION_INTEGRATION === "1")("installed OMP: a session another process still holds", () => {
  it("follows the copy OMP continues in, while it runs and on the next open", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-omp-moved-")));
    process.env.OMP_SESSION_DIR = root;
    const sessionId = crypto.randomUUID();
    const sessionPath = path.join(root, "session.jsonl");
    const now = Date.now();
    fs.writeFileSync(sessionPath, [
      { type: "session", version: 3, id: sessionId, timestamp: new Date(now).toISOString(), cwd: root },
      { type: "message", id: "entry-0", parentId: null, timestamp: new Date(now).toISOString(), message: { role: "user", content: "Say hello.", timestamp: now } },
      { type: "message", id: "entry-1", parentId: "entry-0", timestamp: new Date(now + 1).toISOString(), message: {
        role: "assistant", content: [{ type: "text", text: "Hello." }], api: "openai-responses", provider: "openai", model: "fixture", stopReason: "stop", timestamp: now + 1,
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    const probe = startOmp({ transport: "local" }, { executable, cwd: root, noSession: true });
    let model: string;
    try {
      model = ((await probe.getState()).model as { id: string }).id;
    } finally {
      await probe.stop();
    }
    const descriptor = {
      connectionId: "connection", workspaceId: "workspace", provider: "omp" as const,
      target: { transport: "local" as const }, executable, cwd: root, sessionId: "session",
      providerSessionId: sessionId, providerSessionPath: sessionPath, launchConfig: { model },
    };
    const sessionMoved = vi.fn();
    // Stands in for a process that outlived the connector's side of its link.
    const holder = new AgentRuntimeRegistry({ resolveImages: async () => [] });
    const second = new AgentRuntimeRegistry({ resolveImages: async () => [], sessionMoved });
    const third = new AgentRuntimeRegistry({ resolveImages: async () => [] });
    try {
      const held = await holder.getOrStart(descriptor);
      await reply(held, "FIRST");
      expect(held.movedSession()).toBeNull();

      // A second process opens the held session. OMP lets it read, then moves
      // it to a sibling file on its first write.
      const resumed = await second.getOrStart(descriptor);
      await reply(resumed, "SECOND");
      const moved = resumed.movedSession();
      console.log("moved while running:", JSON.stringify(moved));
      expect(moved).not.toBeNull();
      expect(moved!.providerSessionId).not.toBe(sessionId);
      expect(path.dirname(moved!.providerSessionPath)).toBe(root);
      expect(sessionMoved).toHaveBeenCalledWith("session", resumed);
      await second.stopAll();
      await holder.stopAll();

      // The connector still asks for the session it knew. OMP resumes the
      // copy the conversation went on in, and the runtime follows it.
      const reopened = await third.getOrStart(descriptor);
      console.log("moved at open:", JSON.stringify(reopened.movedSession()));
      expect(reopened.movedSession()).toEqual(moved);
      expect(JSON.stringify(reopened.snapshot().messages)).toContain("SECOND");
      await third.stopAll();

      // The file the conversation left is no longer listed beside its copy.
      const listed = await listOmpWorkspaceSessions({ transport: "local" }, root);
      console.log("listed:", JSON.stringify(listed.map((session) => session.providerSessionId)));
      expect(listed.map((session) => session.providerSessionId)).toEqual([moved!.providerSessionId]);
    } finally {
      await Promise.all([holder.stopAll(), second.stopAll(), third.stopAll()]);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 400_000);
});
