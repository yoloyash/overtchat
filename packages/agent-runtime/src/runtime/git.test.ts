import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  watch as watchFiles,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  spawnOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
  spawnOnHost: mocks.spawnOnHost,
}));

import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import {
  AGENT_WORKSPACE_GIT_PROBE_SCRIPT,
  AGENT_WORKSPACE_GIT_WATCH_SCRIPT,
  inspectAgentWorkspaceGitStatus,
  startAgentWorkspaceGitHostWatcher,
} from "./git";

const connectorId = "11111111-1111-4111-8111-111111111111";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function probe(cwd: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", AGENT_WORKSPACE_GIT_PROBE_SCRIPT],
      { cwd, encoding: "utf8" },
    ),
  ) as Record<string, unknown>;
}

function createRepository(): string {
  // Resolve symlinked temporary roots (macOS /var) to what Git reports.
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-git-")));
  git(directory, "init", "--quiet", "--initial-branch=main");
  git(directory, "config", "user.email", "test@overtchat.local");
  git(directory, "config", "user.name", "OvertChat Test");
  writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\n");
  git(directory, "add", ".");
  git(directory, "commit", "--quiet", "-m", "initial");
  return directory;
}

describe("agent workspace Git status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("summarizes branch, upstream, tracked, and untracked changes", () => {
    const directory = createRepository();
    git(directory, "checkout", "--quiet", "-b", "feature/status");
    git(directory, "branch", "--set-upstream-to", "main");
    writeFileSync(path.join(directory, "tracked.txt"), "one\nthree\nfour\n");
    writeFileSync(path.join(directory, "new.txt"), "alpha\nbeta\n");

    expect(probe(directory)).toMatchObject({
      isGit: true,
      repositoryRoot: directory,
      branch: "feature/status",
      upstream: "main",
      ahead: 0,
      behind: 0,
      changedFiles: 2,
      additions: 4,
      deletions: 1,
      lineStatsComplete: true,
      files: expect.arrayContaining([
        {
          path: "tracked.txt",
          originalPath: null,
          indexStatus: null,
          worktreeStatus: "M",
        },
        {
          path: "new.txt",
          originalPath: null,
          indexStatus: null,
          worktreeStatus: "?",
        },
      ]),
    });
  });

  it("handles non-repositories and incomplete binary line stats", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "overtchat-non-git-"));
    expect(probe(directory)).toEqual({ isGit: false });

    const repository = createRepository();
    writeFileSync(
      path.join(repository, "tracked.txt"),
      Buffer.from([0, 1, 2, 3]),
    );
    expect(probe(repository)).toMatchObject({
      isGit: true,
      changedFiles: 1,
      lineStatsComplete: false,
    });
  });

  it("marks symlink additions incomplete without reading outside the repository", () => {
    const directory = createRepository();
    const outside = path.join(
      directory,
      "..",
      `${path.basename(directory)}-outside.txt`,
    );
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, path.join(directory, "outside-link"));

    const result = probe(directory);

    expect(result).toMatchObject({
      isGit: true,
      changedFiles: 1,
      lineStatsComplete: false,
    });
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
  });

  it("normalizes and validates connector output", async () => {
    mocks.executeOnHost.mockResolvedValue({
      stdout: JSON.stringify({
        isGit: true,
        repositoryRoot: "/srv/project",
        branch: "feature/status",
        upstream: "origin/feature/status",
        ahead: 2,
        behind: 1,
        changedFiles: 3,
        additions: 12,
        deletions: 4,
        lineStatsComplete: true,
        files: [
          {
            path: "src/index.ts",
            originalPath: null,
            indexStatus: null,
            worktreeStatus: "M",
          },
        ],
      }),
      stderr: "",
    });

    await expect(
      inspectAgentWorkspaceGitStatus(
        { transport: "local" },
        "/srv/project",
      ),
    ).resolves.toEqual({
      isGit: true,
      repositoryRoot: "/srv/project",
      branch: "feature/status",
      upstream: "origin/feature/status",
      ahead: 2,
      behind: 1,
      dirty: true,
      changedFiles: 3,
      additions: 12,
      deletions: 4,
      lineStatsComplete: true,
      files: [
        {
          path: "src/index.ts",
          originalPath: null,
          indexStatus: null,
          worktreeStatus: "M",
        },
      ],
    });
    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      { transport: "local" },
      {
        command: "node",
        args: ["-e", AGENT_WORKSPACE_GIT_PROBE_SCRIPT],
        cwd: "/srv/project",
      },
    );

    mocks.executeOnHost.mockResolvedValueOnce({
      stdout: JSON.stringify({ isGit: false }),
      stderr: "",
    });
    await expect(
      inspectAgentWorkspaceGitStatus(
        { transport: "local" },
        "/srv/project",
      ),
    ).resolves.toMatchObject({ isGit: false, dirty: false });

    mocks.executeOnHost.mockResolvedValueOnce({
      stdout: JSON.stringify({ isGit: true, branch: "main" }),
      stderr: "",
    });
    await expect(
      inspectAgentWorkspaceGitStatus(
        { transport: "local" },
        "/srv/project",
      ),
    ).rejects.toThrow("invalid Git metadata");
  });
});

// Runs the real host watcher through the connector-facing wrapper, with the
// host spawner replaced by a direct local Node process.
function startLocalWatcher(env: NodeJS.ProcessEnv = process.env) {
  mocks.spawnOnHost.mockImplementation(
    (_target: unknown, launch: { args: string[] }) => {
      const child = spawn(process.execPath, launch.args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit: new Promise((resolve) =>
          child.once("close", (code, signal) => resolve({ code, signal })),
        ),
        kill: (signal?: NodeJS.Signals) => child.kill(signal),
      };
    },
  );
  const statuses = new Map<string, AgentWorkspaceGitStatus[]>();
  const errors = new Map<string, string[]>();
  const watcher = startAgentWorkspaceGitHostWatcher(
    { transport: "local" },
    {
      status: (id, status) => statuses.set(id, [...(statuses.get(id) ?? []), status]),
      error: (id, message) => errors.set(id, [...(errors.get(id) ?? []), message]),
    },
  );
  const of = (id: string) => statuses.get(id) ?? [];
  return { watcher, statuses: of, errors: (id: string) => errors.get(id) ?? [] };
}

describe("agent workspace Git watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pushes the initial status and each later working tree change", async () => {
    const directory = createRepository();
    const { watcher, statuses, errors } = startLocalWatcher();
    try {
      watcher.watch("workspace", directory);
      await vi.waitFor(() => expect(statuses("workspace")).toHaveLength(1), { timeout: 10_000 });
      expect(statuses("workspace")[0]).toMatchObject({ branch: "main", changedFiles: 0 });
      expect(mocks.spawnOnHost).toHaveBeenCalledTimes(1);
      expect(mocks.spawnOnHost).toHaveBeenCalledWith(
        { transport: "local" },
        { command: "node", args: ["-e", AGENT_WORKSPACE_GIT_WATCH_SCRIPT] },
      );

      writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nthree\n");
      await vi.waitFor(
        () => expect(statuses("workspace").at(-1)).toMatchObject({ changedFiles: 1, additions: 1 }),
        { timeout: 10_000 },
      );

      mkdirSync(path.join(directory, "nested", "deeper"), { recursive: true });
      writeFileSync(path.join(directory, "nested", "deeper", "new.txt"), "x\n");
      await vi.waitFor(
        () => expect(statuses("workspace").at(-1)).toMatchObject({ changedFiles: 2 }),
        { timeout: 10_000 },
      );

      git(directory, "add", ".");
      git(directory, "commit", "--quiet", "-m", "change");
      await vi.waitFor(
        () => expect(statuses("workspace").at(-1)).toMatchObject({ changedFiles: 0, dirty: false }),
        { timeout: 10_000 },
      );

      git(directory, "checkout", "--quiet", "-b", "feature/watched");
      await vi.waitFor(
        () => expect(statuses("workspace").at(-1)).toMatchObject({ branch: "feature/watched" }),
        { timeout: 10_000 },
      );
      expect(errors("workspace")).toEqual([]);
    } finally {
      await watcher.stop();
    }
  }, 60_000);

  it("serves several workspaces from one process and stops watching removed ones", async () => {
    const first = createRepository();
    const second = createRepository();
    const missing = path.join(first, "..", `${path.basename(first)}-missing`);
    const { watcher, statuses, errors } = startLocalWatcher();
    try {
      watcher.watch("first", first);
      watcher.watch("second", second);
      watcher.watch("missing", missing);
      await vi.waitFor(() => {
        expect(statuses("first")).toHaveLength(1);
        expect(statuses("second")).toHaveLength(1);
        expect(errors("missing")).toEqual([
          "The workspace directory is not available on the selected machine.",
        ]);
      }, { timeout: 10_000 });

      writeFileSync(path.join(second, "second.txt"), "x\n");
      await vi.waitFor(
        () => expect(statuses("second").at(-1)).toMatchObject({ changedFiles: 1 }),
        { timeout: 10_000 },
      );
      expect(statuses("first")).toHaveLength(1);

      watcher.unwatch("first");
      writeFileSync(path.join(first, "first.txt"), "x\n");
      writeFileSync(path.join(second, "again.txt"), "x\n");
      await vi.waitFor(
        () => expect(statuses("second").at(-1)).toMatchObject({ changedFiles: 2 }),
        { timeout: 10_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(statuses("first")).toHaveLength(1);
      expect(mocks.spawnOnHost).toHaveBeenCalledTimes(1);
    } finally {
      await watcher.stop();
    }
  }, 40_000);

  it.skipIf(process.platform === "win32")(
    "keeps other workspaces live while one repository is slow to inspect",
    async () => {
      const slow = createRepository();
      const fast = createRepository();
      const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
      const bin = mkdtempSync(path.join(tmpdir(), "overtchat-slow-git-"));
      writeFileSync(
        path.join(bin, "git"),
        `#!/bin/sh\ncase "$PWD" in ${slow}*) sleep 6 ;; esac\nexec "${realGit}" "$@"\n`,
        { mode: 0o755 },
      );
      const { watcher, statuses } = startLocalWatcher({
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      });
      try {
        watcher.watch("slow", slow);
        watcher.watch("fast", fast);
        await vi.waitFor(() => expect(statuses("fast")).toHaveLength(1), { timeout: 5_000 });
        writeFileSync(path.join(fast, "fast.txt"), "x\n");
        await vi.waitFor(
          () => expect(statuses("fast").at(-1)).toMatchObject({ changedFiles: 1 }),
          { timeout: 5_000 },
        );
        expect(statuses("slow")).toHaveLength(0);
      } finally {
        await watcher.stop();
      }
    },
    30_000,
  );

  it("proves the watch with a canary in the Git directory and removes it", async () => {
    const directory = createRepository();
    const gitDirectory = path.join(directory, ".git");
    const canaries = new Set<string>();
    const observer = watchFiles(gitDirectory, (_event, filename) => {
      if (filename && String(filename).startsWith(".overtchat-watcher-canary-")) {
        canaries.add(String(filename));
      }
    });
    const { watcher, statuses } = startLocalWatcher();
    try {
      watcher.watch("workspace", directory);
      await vi.waitFor(() => expect(canaries.size).toBe(1), { timeout: 10_000 });
      await vi.waitFor(
        () =>
          expect(
            readdirSync(gitDirectory).filter((name) => name.startsWith(".overtchat-watcher-canary-")),
          ).toEqual([]),
        { timeout: 10_000 },
      );
      expect(git(directory, "status", "--porcelain")).toBe("");
      expect(statuses("workspace")).toHaveLength(1);
    } finally {
      observer.close();
      await watcher.stop();
    }
  }, 30_000);

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "falls back to polling when the canary cannot be written",
    async () => {
      const directory = createRepository();
      const gitDirectory = path.join(directory, ".git");
      chmodSync(gitDirectory, 0o555);
      const { watcher, statuses } = startLocalWatcher();
      try {
        watcher.watch("workspace", directory);
        await vi.waitFor(() => expect(statuses("workspace")).toHaveLength(1), { timeout: 10_000 });
        writeFileSync(path.join(directory, "polled.txt"), "x\n");
        await vi.waitFor(
          () => expect(statuses("workspace").at(-1)).toMatchObject({ changedFiles: 1 }),
          { timeout: 15_000 },
        );
      } finally {
        await watcher.stop();
        chmodSync(gitDirectory, 0o755);
      }
    },
    30_000,
  );

  it("ignores Git-ignored churn and never rewrites the index", async () => {
    const directory = createRepository();
    writeFileSync(path.join(directory, ".gitignore"), "build/\n");
    git(directory, "add", ".gitignore");
    git(directory, "commit", "--quiet", "-m", "ignore build");
    mkdirSync(path.join(directory, "build"));
    const { watcher, statuses } = startLocalWatcher();
    try {
      watcher.watch("workspace", directory);
      await vi.waitFor(() => expect(statuses("workspace")).toHaveLength(1), { timeout: 10_000 });
      // Let the post-setup recheck settle before measuring.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const index = readFileSync(path.join(directory, ".git", "index"));
      for (let file = 0; file < 20; file += 1) {
        writeFileSync(path.join(directory, "build", `${file}.js`), "x");
      }
      await new Promise((resolve) => setTimeout(resolve, 4_000));

      expect(statuses("workspace")).toHaveLength(1);
      expect(readFileSync(path.join(directory, ".git", "index"))).toEqual(index);
    } finally {
      await watcher.stop();
    }
  }, 30_000);

  it("reports a directory that becomes a repository", async () => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-plain-")));
    const { watcher, statuses } = startLocalWatcher();
    try {
      watcher.watch("workspace", directory);
      await vi.waitFor(() => expect(statuses("workspace")).toHaveLength(1), { timeout: 10_000 });
      expect(statuses("workspace")[0]).toMatchObject({ isGit: false });

      git(directory, "init", "--quiet", "--initial-branch=main");
      writeFileSync(path.join(directory, "file.txt"), "x\n");
      await vi.waitFor(
        () => expect(statuses("workspace").at(-1)).toMatchObject({ isGit: true, changedFiles: 1 }),
        { timeout: 20_000 },
      );
    } finally {
      await watcher.stop();
    }
  }, 40_000);

  it("exits when its input closes", async () => {
    const directory = createRepository();
    const child = spawn(process.execPath, ["-e", AGENT_WORKSPACE_GIT_WATCH_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const closed = new Promise<number | null>((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    child.stdin.write(`${JSON.stringify({ type: "watch", id: "workspace", path: directory })}\n`);
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));

    child.stdin.end();

    await expect(closed).resolves.toBe(0);
  }, 20_000);
});
