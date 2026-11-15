import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeOnHost: vi.fn() }));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import {
  AGENT_TURN_CHANGES_SCRIPT,
  agentTurnSnapshotKey,
  createAgentTurnChangeTracker,
  deleteAgentTurnSnapshots,
} from "./turn-changes";

const KEY = agentTurnSnapshotKey("session-one");
const OTHER_KEY = agentTurnSnapshotKey("session-two");
const LOCAL = { transport: "local" } as const;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRepository(commit = true): string {
  // Resolve symlinked temporary roots (macOS /var) to what Git reports.
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-turn-")));
  git(directory, "init", "--quiet", "--initial-branch=main");
  git(directory, "config", "user.email", "test@overtchat.local");
  git(directory, "config", "user.name", "OvertChat Test");
  if (commit) {
    writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\n");
    writeFileSync(path.join(directory, "removed.txt"), "going\n");
    writeFileSync(path.join(directory, ".gitignore"), "*.log\n");
    git(directory, "add", ".");
    git(directory, "commit", "--quiet", "-m", "initial");
  }
  return directory;
}

type Result = {
  status: string;
  reason?: string;
  base?: string | null;
  head?: string;
  files?: { path: string; previousPath?: string; additions: number; deletions: number }[];
  total?: { files: number; additions: number; deletions: number };
  deleted?: number;
};

function run(
  cwd: string,
  action: string,
  keys = KEY,
  budgetMs = 30_000,
  env: NodeJS.ProcessEnv = process.env,
): Result {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", AGENT_TURN_CHANGES_SCRIPT, action, keys, String(budgetMs)],
      { cwd, encoding: "utf8", env },
    ),
  ) as Result;
}

function snapshots(cwd: string): string[] {
  return git(cwd, "for-each-ref", "--format=%(refname)", "refs/overtchat/")
    .split("\n")
    .filter(Boolean);
}

/** Everything a user could notice: status, index, branches, stashes, HEAD. */
function userState(cwd: string) {
  return {
    status: git(cwd, "status", "--porcelain=v2", "--branch", "--untracked-files=all"),
    index: readFileSync(path.join(cwd, ".git", "index")).toString("base64"),
    refs: git(cwd, "for-each-ref", "refs/heads", "refs/tags", "refs/remotes", "refs/stash"),
    log: git(cwd, "log", "--format=%H", "--branches", "--tags", "--remotes"),
  };
}

function scratchIndexes(cwd: string): string[] {
  return readdirSync(path.join(cwd, ".git")).filter((name) =>
    name.startsWith("overtchat-turn-index-"),
  );
}

describe("agent turn changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts what a turn changed and leaves the repository as the user had it", () => {
    const directory = createRepository();
    // Work the user already had: one staged change, one unstaged.
    writeFileSync(path.join(directory, "staged.txt"), "staged\n");
    git(directory, "add", "staged.txt");
    writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nmine\n");
    const before = userState(directory);

    expect(run(directory, "baseline")).toEqual({ status: "ready" });
    expect(userState(directory)).toEqual(before);
    expect(snapshots(directory)).toEqual([`refs/overtchat/turns/${KEY}/0`]);
    // A second prompt reuses the snapshot that is already there.
    expect(run(directory, "baseline")).toEqual({ status: "ready" });
    expect(snapshots(directory)).toHaveLength(1);

    writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nmine\nturn\n");
    rmSync(path.join(directory, "removed.txt"));
    mkdirSync(path.join(directory, "src"));
    writeFileSync(path.join(directory, "src", "new.ts"), "a\nb\nc\n");
    writeFileSync(path.join(directory, "debug.log"), "ignored\n");
    const during = userState(directory);

    const result = run(directory, "capture");
    expect(result).toMatchObject({
      status: "ready",
      files: [
        { path: "removed.txt", additions: 0, deletions: 1 },
        { path: "src/new.ts", additions: 3, deletions: 0 },
        { path: "tracked.txt", additions: 1, deletions: 0 },
      ],
      total: { files: 3, additions: 4, deletions: 1 },
    });
    expect(result.base).toBe(git(directory, "rev-parse", `refs/overtchat/turns/${KEY}/0`));
    expect(result.head).toBe(git(directory, "rev-parse", `refs/overtchat/turns/${KEY}/1`));
    expect(userState(directory)).toEqual(during);
    expect(scratchIndexes(directory)).toEqual([]);

    // The next turn is compared against the end of this one.
    expect(run(directory, "capture")).toMatchObject({
      status: "ready",
      base: result.head,
      files: [],
      total: { files: 0, additions: 0, deletions: 0 },
    });
  });

  it("has nothing to compare a first snapshot against, and skips folders that are not repositories", () => {
    const directory = createRepository();
    writeFileSync(path.join(directory, "tracked.txt"), "changed\n");
    expect(run(directory, "capture")).toMatchObject({
      status: "ready",
      base: null,
      files: [],
    });

    const plain = mkdtempSync(path.join(tmpdir(), "overtchat-turn-plain-"));
    expect(run(plain, "baseline")).toEqual({ status: "missing", reason: "not-git" });
    expect(run(plain, "capture")).toEqual({ status: "missing", reason: "not-git" });
  });

  it("lists a rename with its old path and counts a binary file as no lines", () => {
    const directory = createRepository();
    writeFileSync(
      path.join(directory, "long.txt"),
      Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n") + "\n",
    );
    git(directory, "add", ".");
    git(directory, "commit", "--quiet", "-m", "long");
    run(directory, "baseline");

    renameSync(path.join(directory, "long.txt"), path.join(directory, "renamed.txt"));
    writeFileSync(path.join(directory, "image.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));

    expect(run(directory, "capture")).toMatchObject({
      files: [
        { path: "image.bin", additions: 0, deletions: 0 },
        { path: "renamed.txt", previousPath: "long.txt", additions: 0, deletions: 0 },
      ],
      total: { files: 2, additions: 0, deletions: 0 },
    });
  });

  it("keeps the turn's own commits and leaves out what a pull brought in", () => {
    const origin = createRepository();
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-turn-clone-")));
    git(directory, "clone", "--quiet", origin, ".");
    git(directory, "config", "user.email", "test@overtchat.local");
    git(directory, "config", "user.name", "OvertChat Test");
    // Upstream work that predates the turn and arrives during it.
    writeFileSync(path.join(origin, "upstream.txt"), "theirs\n".repeat(50));
    git(origin, "add", ".");
    execFileSync("git", ["commit", "--quiet", "-m", "upstream"], {
      cwd: origin,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
      },
    });
    run(directory, "baseline");

    writeFileSync(path.join(directory, "committed.txt"), "by the turn\n");
    git(directory, "add", "committed.txt");
    git(directory, "commit", "--quiet", "-m", "turn commit");
    git(directory, "pull", "--quiet", "--rebase");
    writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nuncommitted\n");

    expect(git(directory, "log", "--format=%s", "-3")).toContain("upstream");
    expect(run(directory, "capture")).toMatchObject({
      files: [
        { path: "committed.txt", additions: 1, deletions: 0 },
        { path: "tracked.txt", additions: 1, deletions: 0 },
      ],
      total: { files: 2, additions: 2, deletions: 0 },
    });
  });

  it("counts only the workspace when it is a subdirectory of its repository", () => {
    const directory = createRepository();
    const workspace = path.join(directory, "packages", "app");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, "index.ts"), "one\n");
    git(directory, "add", ".");
    git(directory, "commit", "--quiet", "-m", "app");
    run(workspace, "baseline");

    writeFileSync(path.join(workspace, "index.ts"), "one\ntwo\n");
    writeFileSync(path.join(directory, "tracked.txt"), "outside the workspace\n");

    expect(run(workspace, "capture")).toMatchObject({
      workspacePath: "packages/app",
      files: [{ path: "packages/app/index.ts", additions: 1, deletions: 0 }],
      total: { files: 1, additions: 1, deletions: 0 },
    });
  });

  it("snapshots around an embedded repository that has no commit yet", () => {
    const directory = createRepository();
    run(directory, "baseline");
    mkdirSync(path.join(directory, "vendor", "fresh"), { recursive: true });
    git(path.join(directory, "vendor", "fresh"), "init", "--quiet");
    writeFileSync(path.join(directory, "vendor", "fresh", "file.txt"), "nested\n");
    writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nthree\n");

    expect(run(directory, "capture")).toMatchObject({
      status: "ready",
      files: [{ path: "tracked.txt", additions: 1, deletions: 0 }],
    });
  });

  it("works in a linked worktree, in a repository with no commits, and with signing configured", () => {
    const directory = createRepository();
    git(directory, "config", "commit.gpgsign", "true");
    git(directory, "config", "gpg.program", "false");
    const worktree = path.join(
      realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-turn-linked-"))),
      "tree",
    );
    git(directory, "worktree", "add", "--quiet", "-b", "linked", worktree);
    run(worktree, "baseline");
    writeFileSync(path.join(worktree, "tracked.txt"), "one\ntwo\nlinked\n");
    expect(run(worktree, "capture")).toMatchObject({
      files: [{ path: "tracked.txt", additions: 1, deletions: 0 }],
    });
    // The worktree's snapshots live in the repository it was created from.
    expect(snapshots(directory)).toHaveLength(2);
    expect(scratchIndexes(directory)).toEqual([]);

    const empty = createRepository(false);
    run(empty, "baseline");
    writeFileSync(path.join(empty, "first.txt"), "hello\n");
    expect(run(empty, "capture")).toMatchObject({
      files: [{ path: "first.txt", additions: 1, deletions: 0 }],
    });
  });

  it("caps the file list while the totals count every file", () => {
    const directory = createRepository();
    run(directory, "baseline");
    for (let index = 0; index < 230; index += 1) {
      writeFileSync(path.join(directory, `file-${String(index).padStart(3, "0")}.txt`), "x\n");
    }
    const result = run(directory, "capture");
    expect(result.files).toHaveLength(200);
    expect(result.files?.[0]?.path).toBe("file-000.txt");
    expect(result.total).toEqual({ files: 230, additions: 230, deletions: 0 });
  });

  it("deletes only the named sessions' snapshots", () => {
    const directory = createRepository();
    run(directory, "baseline");
    run(directory, "capture");
    run(directory, "baseline", OTHER_KEY);

    expect(run(directory, "delete", KEY)).toEqual({ status: "ready", deleted: 2 });
    expect(snapshots(directory)).toEqual([`refs/overtchat/turns/${OTHER_KEY}/0`]);
    expect(run(directory, "delete", `${KEY},${OTHER_KEY}`)).toEqual({
      status: "ready",
      deleted: 1,
    });
    expect(snapshots(directory)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "gives up at its budget without leaving a scratch index behind",
    () => {
      const directory = createRepository();
      const bin = mkdtempSync(path.join(tmpdir(), "overtchat-turn-bin-"));
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      writeFileSync(
        path.join(bin, "git"),
        `#!/bin/sh\ncase " $* " in *" add "*) sleep 20;; esac\nexec "${realGit}" "$@"\n`,
      );
      chmodSync(path.join(bin, "git"), 0o755);
      const started = Date.now();
      const result = run(directory, "baseline", KEY, 500, {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      });
      expect(result).toEqual({ status: "error", reason: "timeout" });
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(scratchIndexes(directory)).toEqual([]);
      expect(snapshots(directory)).toEqual([]);
    },
  );
});

describe("agent turn change tracker", () => {
  const calls: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    mocks.executeOnHost.mockImplementation(
      (
        _target: unknown,
        launch: { command: string; args: string[]; cwd: string },
        options: { timeoutMs?: number },
      ) =>
        new Promise((resolve, reject) => {
          calls.push(`${launch.args[2]}:${options.timeoutMs}`);
          execFile(
            process.execPath,
            launch.args,
            { cwd: launch.cwd, encoding: "utf8" },
            (error, stdout, stderr) => {
              if (error) reject(error);
              else resolve({ stdout, stderr });
            },
          );
        }),
    );
  });

  it("takes one first snapshot, then reports each turn against the one before", async () => {
    const directory = createRepository();
    const tracker = createAgentTurnChangeTracker(LOCAL, directory, "session-one");

    await tracker.prepare();
    await tracker.prepare();
    expect(calls).toEqual(["baseline:5000"]);

    expect(await tracker.finish()).toBeNull();
    writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nthree\n");
    const changes = await tracker.finish();
    expect(changes).toMatchObject({
      files: [{ path: "tracked.txt", additions: 1, deletions: 0 }],
      total: { files: 1, additions: 1, deletions: 0 },
    });
    expect(changes?.base).toMatch(/^[0-9a-f]{40}$/);
    expect(calls).toEqual(["baseline:5000", "capture:32000", "capture:32000"]);
  });

  it("looks for an earlier snapshot when a session opens, without writing one", async () => {
    const directory = createRepository();
    const fresh = createAgentTurnChangeTracker(LOCAL, directory, "session-one");
    await fresh.warm();
    expect(snapshots(directory)).toEqual([]);
    await fresh.prepare();
    expect(snapshots(directory)).toHaveLength(1);
    expect(calls).toEqual(["probe:5000", "baseline:5000"]);

    // The next runtime finds it, so its first prompt has nothing to wait for.
    calls.length = 0;
    const reopened = createAgentTurnChangeTracker(LOCAL, directory, "session-one");
    await reopened.warm();
    await reopened.prepare();
    expect(calls).toEqual(["probe:5000"]);

    calls.length = 0;
    const plain = mkdtempSync(path.join(tmpdir(), "overtchat-turn-plain-"));
    const untracked = createAgentTurnChangeTracker(LOCAL, plain, "session-one");
    await untracked.warm();
    await untracked.prepare();
    expect(await untracked.finish()).toBeNull();
    expect(calls).toEqual(["probe:5000"]);
  });

  it("finds the earlier snapshot again after the runtime restarts", async () => {
    const directory = createRepository();
    const first = createAgentTurnChangeTracker(LOCAL, directory, "session-one");
    await first.prepare();
    writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nthree\n");

    const second = createAgentTurnChangeTracker(LOCAL, directory, "session-one");
    await second.prepare();
    expect(snapshots(directory)).toHaveLength(1);
    expect(await second.finish()).toMatchObject({
      total: { files: 1, additions: 1, deletions: 0 },
    });
  });

  it("stops asking once the folder turns out not to be a repository", async () => {
    const plain = mkdtempSync(path.join(tmpdir(), "overtchat-turn-plain-"));
    const tracker = createAgentTurnChangeTracker(LOCAL, plain, "session-one");
    await tracker.prepare();
    await tracker.prepare();
    expect(await tracker.finish()).toBeNull();
    expect(calls).toEqual(["baseline:5000"]);
  });

  it("stops snapshotting a workspace that cannot be captured in time", async () => {
    mocks.executeOnHost.mockRejectedValue(
      new Error("Agent command timed out after 32000 milliseconds."),
    );
    const tracker = createAgentTurnChangeTracker(LOCAL, "/workspace", "session-one");
    // A slow first snapshot only costs that turn its comparison.
    await tracker.prepare();
    expect(await tracker.finish()).toBeNull();
    expect(await tracker.finish()).toBeNull();
    await tracker.prepare();
    expect(mocks.executeOnHost).toHaveBeenCalledTimes(2);
  });

  it("deletes the snapshots of several sessions in one run", async () => {
    const directory = createRepository();
    await createAgentTurnChangeTracker(LOCAL, directory, "session-one").prepare();
    await createAgentTurnChangeTracker(LOCAL, directory, "session-two").prepare();
    expect(snapshots(directory)).toHaveLength(2);
    calls.length = 0;

    await deleteAgentTurnSnapshots(LOCAL, directory, ["session-one", "session-two"]);
    expect(calls).toEqual(["delete:7000"]);
    expect(snapshots(directory)).toEqual([]);
  });
});
