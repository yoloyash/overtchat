import { describe, expect, it, vi } from "vitest";
import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import type { HostTarget } from "@overtchat/agent-runtime";
import { WorkspaceGitStatusReader, workspaceGitKey } from "./workspace-git";

const local: HostTarget = { transport: "local", shellMode: "login" };
const remote: HostTarget = { transport: "ssh", alias: "box", shellMode: "login" };

function status(branch: string): AgentWorkspaceGitStatus {
  return {
    isGit: true,
    repositoryRoot: "/workspace",
    branch,
    upstream: null,
    ahead: null,
    behind: null,
    dirty: false,
    changedFiles: 0,
    additions: 0,
    deletions: 0,
    lineStatsComplete: true,
    files: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("WorkspaceGitStatusReader", () => {
  it("shares one inspection between concurrent callers", async () => {
    const pending = deferred<AgentWorkspaceGitStatus>();
    const inspect = vi.fn(() => pending.promise);
    const reader = new WorkspaceGitStatusReader(inspect);

    const first = reader.read(local, "/workspace");
    const second = reader.read(local, "/workspace");
    pending.resolve(status("main"));

    await expect(first).resolves.toEqual(status("main"));
    await expect(second).resolves.toEqual(status("main"));
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("reuses a settled status briefly and then inspects again", async () => {
    let now = 1_000;
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(status("main"))
      .mockResolvedValueOnce(status("feature"));
    const reader = new WorkspaceGitStatusReader(inspect, () => now, 1_500);

    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("main"),
    );
    now += 1_499;
    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("main"),
    );
    now += 1;
    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("feature"),
    );
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("does not reuse failures", async () => {
    const inspect = vi
      .fn()
      .mockRejectedValueOnce(new Error("Git is not installed."))
      .mockResolvedValueOnce(status("main"));
    const reader = new WorkspaceGitStatusReader(inspect);

    await expect(reader.read(local, "/workspace")).rejects.toThrow(
      "Git is not installed.",
    );
    await expect(reader.read(local, "/workspace")).resolves.toEqual(
      status("main"),
    );
  });

  it("keeps workspaces on different hosts and paths separate", async () => {
    const inspect = vi.fn(async (target: HostTarget, path: string) =>
      status(`${target.transport}:${path}`),
    );
    const reader = new WorkspaceGitStatusReader(inspect);

    await Promise.all([
      reader.read(local, "/workspace"),
      reader.read(remote, "/workspace"),
      reader.read(local, "/other"),
    ]);

    expect(inspect).toHaveBeenCalledTimes(3);
    expect(workspaceGitKey(local, "/workspace")).not.toBe(
      workspaceGitKey(remote, "/workspace"),
    );
  });
});
