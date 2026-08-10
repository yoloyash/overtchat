import {
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import {
  AGENT_WORKSPACE_GIT_PROBE_SCRIPT,
  inspectAgentWorkspaceGitStatus,
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
  const directory = mkdtempSync(path.join(tmpdir(), "overtchat-git-"));
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
      }),
      stderr: "",
    });

    await expect(
      inspectAgentWorkspaceGitStatus(
        { connectorId, transport: "local" },
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
    });
    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      { connectorId, transport: "local" },
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
        { connectorId, transport: "local" },
        "/srv/project",
      ),
    ).resolves.toMatchObject({ isGit: false, dirty: false });

    mocks.executeOnHost.mockResolvedValueOnce({
      stdout: JSON.stringify({ isGit: true, branch: "main" }),
      stderr: "",
    });
    await expect(
      inspectAgentWorkspaceGitStatus(
        { connectorId, transport: "local" },
        "/srv/project",
      ),
    ).rejects.toThrow("invalid Git metadata");
  });
});
