import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";
import { listPiWorkspaceSessions } from "./sessions";

const originalSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;

beforeAll(configureLocalTestProcessSpawner);

afterEach(() => {
  if (originalSessionDir === undefined) {
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
  } else {
    process.env.PI_CODING_AGENT_SESSION_DIR = originalSessionDir;
  }
});

describe("Pi session discovery", () => {
  it("restores model and reasoning from native session history", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-pi-history-"));
    const workspace = path.join(root, "workspace");
    const sessions = path.join(root, "sessions");
    fs.mkdirSync(workspace);
    fs.mkdirSync(sessions);
    process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
    fs.writeFileSync(
      path.join(sessions, "session.jsonl"),
      [
        { type: "session", id: "native", cwd: workspace, timestamp: "2026-01-01T00:00:00.000Z" },
        { type: "model_change", provider: "openrouter", modelId: "anthropic/claude" },
        { type: "thinking_level_change", thinkingLevel: "high" },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );

    try {
      await expect(
        listPiWorkspaceSessions({ transport: "local" }, workspace),
      ).resolves.toEqual([
        expect.objectContaining({
          providerSessionId: "native",
          launchConfig: {
            model: "openrouter/anthropic/claude",
            thinkingOptionId: "high",
          },
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
