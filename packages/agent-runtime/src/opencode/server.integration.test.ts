import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteOpenCodeSession, startOpenCodeRuntime } from "./client";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

const runIntegration = process.env.RUN_OPENCODE_INTEGRATION === "1";
const executable = process.env.OPENCODE_COMMAND ?? "opencode";
const target = { transport: "local" as const };

describe.runIf(runIntegration)("installed OpenCode server restarts", () => {
  let root: string;

  beforeAll(() => {
    configureLocalTestProcessSpawner();
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-opencode-server-")),
    );
    // A private data directory keeps these sessions out of the developer's.
    for (const name of ["DATA", "STATE", "CONFIG"]) {
      const directory = path.join(root, "xdg", name.toLowerCase());
      fs.mkdirSync(directory, { recursive: true });
      vi.stubEnv(`XDG_${name}_HOME`, directory);
    }
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it(
    "serves the first request after the only session on the machine stops",
    async () => {
      // Stopping the last session stops its server, and the next request
      // starts another on the same port. Three rounds, because the failure
      // this guards against depends on what the previous server left behind.
      for (let round = 0; round < 3; round++) {
        const cwd = path.join(root, `workspace-${round}`);
        fs.mkdirSync(cwd);
        const client = startOpenCodeRuntime(target, { executable, cwd });
        let sessionId: string;
        try {
          sessionId = (await client.getState()).sessionId as string;
        } finally {
          await client.stop();
        }
        await expect(
          deleteOpenCodeSession(target, executable, cwd, sessionId),
        ).resolves.toBeUndefined();
      }
    },
    120_000,
  );
});
