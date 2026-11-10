import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listOpenCodeSessions } from "./client";
import { openCodeServerPool, type OpenCodeServerLease } from "./server";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";

const runIntegration = process.env.RUN_OPENCODE_INTEGRATION === "1";
const executable = process.env.OPENCODE_COMMAND ?? "opencode";
const target = { transport: "local" as const };

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=OvertChat", "-c", "user.email=test@overtchat.invalid", ...args],
    { cwd, stdio: "ignore" },
  );
}

describe.runIf(runIntegration)("installed OpenCode session listing", () => {
  let root: string;
  let lease: OpenCodeServerLease;
  const folders = {} as Record<
    "plain" | "other" | "empty" | "freshRepo" | "repo" | "subfolder" | "worktree" | "link",
    string
  >;

  async function createSession(directory: string, parentID?: string): Promise<string> {
    const client = createOpencodeClient({ baseUrl: lease.baseUrl, directory });
    const created = await client.session.create({
      directory,
      ...(parentID ? { parentID } : {}),
    });
    if (!created.data) throw new Error(`OpenCode did not create a session in ${directory}.`);
    return created.data.id;
  }

  async function listed(directory: string): Promise<string[]> {
    const sessions = await listOpenCodeSessions(target, executable, directory);
    return sessions.map((session) => session.id).sort();
  }

  beforeAll(async () => {
    configureLocalTestProcessSpawner();
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-opencode-sessions-")),
    );
    // A private data directory: the test scripts its own session history and
    // never reads or writes the developer's.
    for (const name of ["DATA", "STATE", "CONFIG"]) {
      const directory = path.join(root, "xdg", name.toLowerCase());
      fs.mkdirSync(directory, { recursive: true });
      vi.stubEnv(`XDG_${name}_HOME`, directory);
    }
    for (const name of ["plain", "other", "empty", "freshRepo", "repo"] as const) {
      folders[name] = path.join(root, name);
      fs.mkdirSync(folders[name]);
    }
    git(folders.freshRepo, "init", "-q");
    git(folders.repo, "init", "-q");
    folders.subfolder = path.join(folders.repo, "packages", "app");
    fs.mkdirSync(folders.subfolder, { recursive: true });
    fs.writeFileSync(path.join(folders.subfolder, "index.ts"), "export {};\n");
    git(folders.repo, "add", ".");
    git(folders.repo, "commit", "-q", "-m", "initial");
    folders.worktree = path.join(root, "worktree");
    git(folders.repo, "worktree", "add", "-q", "-b", "feature", folders.worktree);
    folders.link = path.join(root, "link");
    fs.symlinkSync(folders.plain, folders.link);
    lease = await openCodeServerPool.acquire(target, executable);
  }, 60_000);

  afterAll(async () => {
    await lease?.release();
    vi.unstubAllEnvs();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it(
    "lists only the sessions started in the workspace folder",
    async () => {
      const plain = await createSession(folders.plain);
      await createSession(folders.plain, plain);
      const other = await createSession(folders.other);
      const freshRepo = await createSession(folders.freshRepo);
      const repo = await createSession(folders.repo);
      const subfolder = await createSession(folders.subfolder);
      const worktree = await createSession(folders.worktree);

      // Folders outside a repository share one OpenCode project, and so does a
      // repository with no commits yet. None of them may see the others.
      expect(await listed(folders.empty)).toEqual([]);
      expect(await listed(folders.plain)).toEqual([plain]);
      expect(await listed(folders.other)).toEqual([other]);
      expect(await listed(folders.freshRepo)).toEqual([freshRepo]);
      // A repository, its subfolders, and its worktrees share a project too.
      expect(await listed(folders.repo)).toEqual([repo]);
      expect(await listed(folders.subfolder)).toEqual([subfolder]);
      expect(await listed(folders.worktree)).toEqual([worktree]);
      // OpenCode stores the resolved folder, however the workspace names it.
      expect(await listed(folders.link)).toEqual([plain]);
      expect(await listed(`${folders.plain}${path.sep}`)).toEqual([plain]);
    },
    60_000,
  );

  it(
    "lists every session of a folder with more than OpenCode's default page",
    async () => {
      const created: string[] = [];
      for (let index = 0; index < 105; index++) {
        created.push(await createSession(folders.empty));
      }
      expect(await listed(folders.empty)).toEqual(created.sort());
    },
    60_000,
  );
});
