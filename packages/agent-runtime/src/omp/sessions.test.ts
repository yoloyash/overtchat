import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";
import { listOmpWorkspaceSessions } from "./sessions";

const originalSessionDir = process.env.OMP_SESSION_DIR;

beforeAll(configureLocalTestProcessSpawner);

afterEach(() => {
  if (originalSessionDir === undefined) {
    delete process.env.OMP_SESSION_DIR;
  } else {
    process.env.OMP_SESSION_DIR = originalSessionDir;
  }
});

describe("OMP session discovery", () => {
  it("restores model and reasoning with OMP's launch-mode default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-omp-history-"));
    const workspace = path.join(root, "workspace");
    const sessions = path.join(root, "sessions");
    fs.mkdirSync(workspace);
    fs.mkdirSync(sessions);
    process.env.OMP_SESSION_DIR = sessions;
    fs.writeFileSync(
      path.join(sessions, "session.jsonl"),
      [
        { type: "session", id: "native", cwd: workspace, timestamp: "2026-01-01T00:00:00.000Z" },
        { type: "model_change", model: "openai/gpt-5" },
        { type: "thinking_level_change", thinkingLevel: "xhigh" },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    try {
      await expect(
        listOmpWorkspaceSessions({ transport: "local" }, workspace),
      ).resolves.toEqual([
        expect.objectContaining({
          providerSessionId: "native",
          launchConfig: {
            model: "openai/gpt-5",
            thinkingOptionId: "xhigh",
            modeId: "full",
          },
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("lists a conversation that continued in another file once, as the continuation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-omp-history-"));
    const workspace = path.join(root, "workspace");
    const sessions = path.join(root, "sessions");
    fs.mkdirSync(workspace);
    fs.mkdirSync(sessions);
    process.env.OMP_SESSION_DIR = sessions;
    const write = (name: string, entries: unknown[]) =>
      fs.writeFileSync(
        path.join(sessions, name),
        entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      );
    const message = (id: string, role: string, text: string) => ({
      type: "message", id, timestamp: "2026-01-01T00:00:01.000Z",
      message: { role, content: text },
    });
    const header = (id: string, continuationOf?: string) => ({
      type: "session", id, cwd: workspace, timestamp: "2026-01-01T00:00:00.000Z",
      ...(continuationOf ? { parentSession: continuationOf, continuationOf } : {}),
    });
    // Moved off its file while another process held it: the copy holds every turn.
    write("first.jsonl", [header("first"), message("a", "user", "Hello"), message("b", "assistant", "Hi")]);
    write("first-continued.jsonl", [
      header("first-continued", "first"),
      message("a", "user", "Hello"), message("b", "assistant", "Hi"), message("c", "user", "More"),
    ]);
    // Both copies went on after the move, so neither replaces the other.
    write("second.jsonl", [header("second"), message("d", "user", "Start"), message("e", "user", "Only here")]);
    write("second-continued.jsonl", [
      header("second-continued", "second"),
      message("d", "user", "Start"), message("f", "user", "Only there"),
    ]);

    try {
      const listed = await listOmpWorkspaceSessions({ transport: "local" }, workspace);
      expect(listed.map((session) => session.providerSessionId).sort()).toEqual([
        "first-continued",
        "second",
        "second-continued",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
