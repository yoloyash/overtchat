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
});
