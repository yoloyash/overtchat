import { describe, expect, it, vi } from "vitest";
import type { AgentWorkspaceGitStatus } from "@overtchat/agent-bridge";
import type {
  AgentWorkspaceGitWatch,
  AgentWorkspaceGitWatchHandlers,
  HostTarget,
} from "@overtchat/agent-runtime";
import {
  WorkspaceGitStatusReader,
  WorkspaceGitWatches,
  workspaceGitKey,
} from "./workspace-git";

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

type FakeWatcher = {
  target: HostTarget;
  path: string;
  handlers: AgentWorkspaceGitWatchHandlers;
  exit(): void;
  stopped: boolean;
};

function fakeWatchers() {
  const started: FakeWatcher[] = [];
  const start = vi.fn(
    (
      target: HostTarget,
      path: string,
      handlers: AgentWorkspaceGitWatchHandlers,
    ): AgentWorkspaceGitWatch => {
      let exit!: () => void;
      const exited = new Promise<void>((resolve) => {
        exit = resolve;
      });
      const watcher: FakeWatcher = {
        target,
        path,
        handlers,
        exit,
        stopped: false,
      };
      started.push(watcher);
      return {
        exited,
        async stop() {
          watcher.stopped = true;
          exit();
        },
      };
    },
  );
  return { started, start };
}

describe("WorkspaceGitWatches", () => {
  it("shares one watcher per workspace and fans statuses out to every watch", async () => {
    const { started, start } = fakeWatchers();
    const watches = new WorkspaceGitWatches(
      new WorkspaceGitStatusReader(vi.fn()),
      start,
    );
    const first = vi.fn();
    const second = vi.fn();

    const initialFirst = watches.watch("a", local, "/workspace", first);
    const initialSecond = watches.watch("b", local, "/workspace", second);
    started[0]!.handlers.status(status("main"));

    await expect(initialFirst).resolves.toEqual({
      status: status("main"),
      revision: 1,
    });
    await expect(initialSecond).resolves.toEqual({
      status: status("main"),
      revision: 1,
    });
    expect(start).toHaveBeenCalledTimes(1);

    started[0]!.handlers.status(status("feature"));
    expect(first).toHaveBeenLastCalledWith(status("feature"), 2);
    expect(second).toHaveBeenLastCalledWith(status("feature"), 2);
    expect(watches.current(local, "/workspace")).toEqual(status("feature"));
    await watches.stop();
  });

  it("answers from a direct inspection when the watcher cannot report", async () => {
    const { started, start } = fakeWatchers();
    const inspect = vi.fn().mockResolvedValue(status("direct"));
    const watches = new WorkspaceGitWatches(
      new WorkspaceGitStatusReader(inspect),
      start,
    );

    const initial = watches.watch("a", local, "/workspace", vi.fn());
    started[0]!.handlers.error("Git is not installed on the selected machine.");

    await expect(initial).resolves.toEqual({
      status: status("direct"),
      revision: 0,
    });
    expect(watches.current(local, "/workspace")).toBeNull();
    await watches.stop();
  });

  it("keeps an unwatched process for the idle grace and then stops it", async () => {
    vi.useFakeTimers();
    try {
      const { started, start } = fakeWatchers();
      const watches = new WorkspaceGitWatches(
        new WorkspaceGitStatusReader(vi.fn()),
        start,
        { idleGraceMs: 1_000 },
      );
      const initial = watches.watch("a", local, "/workspace", vi.fn());
      started[0]!.handlers.status(status("main"));
      await initial;

      watches.unwatchAll();
      await vi.advanceTimersByTimeAsync(500);
      const rewatch = watches.watch("b", local, "/workspace", vi.fn());
      await expect(rewatch).resolves.toEqual({
        status: status("main"),
        revision: 1,
      });
      expect(start).toHaveBeenCalledTimes(1);

      watches.unwatch("b");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(started[0]!.stopped).toBe(true);
      expect(watches.current(local, "/workspace")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts a watcher that exits while still watched", async () => {
    vi.useFakeTimers();
    try {
      const { started, start } = fakeWatchers();
      const listener = vi.fn();
      const watches = new WorkspaceGitWatches(
        new WorkspaceGitStatusReader(vi.fn()),
        start,
        { restartBaseMs: 100 },
      );
      const initial = watches.watch("a", remote, "/workspace", listener);
      started[0]!.handlers.status(status("main"));
      await initial;

      started[0]!.exit();
      await vi.advanceTimersByTimeAsync(0);
      expect(watches.current(remote, "/workspace")).toBeNull();
      await vi.advanceTimersByTimeAsync(100);
      expect(start).toHaveBeenCalledTimes(2);

      started[1]!.handlers.status(status("feature"));
      expect(listener).toHaveBeenLastCalledWith(status("feature"), 2);
      await watches.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores reports from a replaced watcher", async () => {
    vi.useFakeTimers();
    try {
      const { started, start } = fakeWatchers();
      const listener = vi.fn();
      const watches = new WorkspaceGitWatches(
        new WorkspaceGitStatusReader(vi.fn()),
        start,
        { restartBaseMs: 10 },
      );
      const initial = watches.watch("a", local, "/workspace", listener);
      started[0]!.handlers.status(status("main"));
      await initial;
      started[0]!.exit();
      await vi.advanceTimersByTimeAsync(10);

      started[0]!.handlers.status(status("stale"));
      expect(listener).not.toHaveBeenCalledWith(status("stale"), expect.anything());
      await watches.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
