import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
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
  watchAgentWorkspaceGitStatus,
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

// Runs the real watcher in a repository through the connector-facing wrapper,
// with the host spawner replaced by a direct local Node process.
function startLocalWatch(directory: string) {
  mocks.spawnOnHost.mockImplementation(
    (_target: unknown, launch: { args: string[]; cwd: string }) => {
      const child = spawn(process.execPath, launch.args, {
        cwd: launch.cwd,
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
  const statuses: AgentWorkspaceGitStatus[] = [];
  const errors: string[] = [];
  const watch = watchAgentWorkspaceGitStatus(
    { transport: "local" },
    directory,
    {
      status: (status) => statuses.push(status),
      error: (message) => errors.push(message),
    },
  );
  return { watch, statuses, errors };
}

describe("agent workspace Git watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pushes the initial status and each later working tree change", async () => {
    const directory = createRepository();
    const { watch, statuses, errors } = startLocalWatch(directory);
    try {
      await vi.waitFor(() => expect(statuses).toHaveLength(1), { timeout: 10_000 });
      expect(statuses[0]).toMatchObject({ branch: "main", changedFiles: 0 });
      expect(mocks.spawnOnHost).toHaveBeenCalledWith(
        { transport: "local" },
        {
          command: "node",
          args: ["-e", AGENT_WORKSPACE_GIT_WATCH_SCRIPT],
          cwd: directory,
        },
      );

      writeFileSync(path.join(directory, "tracked.txt"), "one\ntwo\nthree\n");
      await vi.waitFor(
        () => expect(statuses.at(-1)).toMatchObject({ changedFiles: 1, additions: 1 }),
        { timeout: 10_000 },
      );

      mkdirSync(path.join(directory, "nested", "deeper"), { recursive: true });
      writeFileSync(path.join(directory, "nested", "deeper", "new.txt"), "x\n");
      await vi.waitFor(
        () => expect(statuses.at(-1)).toMatchObject({ changedFiles: 2 }),
        { timeout: 10_000 },
      );

      git(directory, "add", ".");
      git(directory, "commit", "--quiet", "-m", "change");
      await vi.waitFor(
        () => expect(statuses.at(-1)).toMatchObject({ changedFiles: 0, dirty: false }),
        { timeout: 10_000 },
      );

      git(directory, "checkout", "--quiet", "-b", "feature/watched");
      await vi.waitFor(
        () => expect(statuses.at(-1)).toMatchObject({ branch: "feature/watched" }),
        { timeout: 10_000 },
      );
      expect(errors).toEqual([]);
    } finally {
      await watch.stop();
    }
  }, 60_000);

  it("ignores Git-ignored churn and never rewrites the index", async () => {
    const directory = createRepository();
    writeFileSync(path.join(directory, ".gitignore"), "build/\n");
    git(directory, "add", ".gitignore");
    git(directory, "commit", "--quiet", "-m", "ignore build");
    mkdirSync(path.join(directory, "build"));
    const { watch, statuses } = startLocalWatch(directory);
    try {
      await vi.waitFor(() => expect(statuses).toHaveLength(1), { timeout: 10_000 });
      const index = readFileSync(path.join(directory, ".git", "index"));
      for (let file = 0; file < 20; file += 1) {
        writeFileSync(path.join(directory, "build", `${file}.js`), "x");
      }
      await new Promise((resolve) => setTimeout(resolve, 4_000));

      expect(statuses).toHaveLength(1);
      expect(readFileSync(path.join(directory, ".git", "index"))).toEqual(index);
    } finally {
      await watch.stop();
    }
  }, 30_000);

  it("reports a directory that becomes a repository", async () => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "overtchat-plain-")));
    const { watch, statuses } = startLocalWatch(directory);
    try {
      await vi.waitFor(() => expect(statuses).toHaveLength(1), { timeout: 10_000 });
      expect(statuses[0]).toMatchObject({ isGit: false });

      git(directory, "init", "--quiet", "--initial-branch=main");
      writeFileSync(path.join(directory, "file.txt"), "x\n");
      await vi.waitFor(
        () => expect(statuses.at(-1)).toMatchObject({ isGit: true, changedFiles: 1 }),
        { timeout: 20_000 },
      );
    } finally {
      await watch.stop();
    }
  }, 40_000);

  it("exits when its input closes", async () => {
    const directory = createRepository();
    const child = spawn(process.execPath, ["-e", AGENT_WORKSPACE_GIT_WATCH_SCRIPT], {
      cwd: directory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const closed = new Promise<number | null>((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));

    child.stdin.end();

    await expect(closed).resolves.toBe(0);
  }, 20_000);
});
