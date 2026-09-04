import { describe, expect, it, vi } from "vitest";
import type { HostConnectorCommand } from "@overtchat/agent-bridge";
import {
  ConnectorCommandScheduler,
  isConnectorCommandBarrier,
} from "./command-scheduler";

function request(
  id: string,
  type: "git_status" | "get_catalog" | "create_session",
): Extract<HostConnectorCommand, { type: "request" }> {
  const requests = {
    git_status: {
      type: "git_status" as const,
      target: { transport: "local" as const, shellMode: "login" as const },
      path: "/workspace",
    },
    get_catalog: {
      type: "get_catalog" as const,
      workspace: {
        connectionId: "connection",
        workspaceId: "workspace",
        provider: "codex" as const,
        target: { transport: "local" as const, shellMode: "login" as const },
        executable: "codex",
        cwd: "/workspace",
      },
    },
    create_session: {
      type: "create_session" as const,
      sessionId: id,
      workspace: {
        connectionId: "connection",
        workspaceId: "workspace",
        provider: "codex" as const,
        target: { transport: "local" as const, shellMode: "login" as const },
        executable: "codex",
        cwd: "/workspace",
      },
      launchConfig: {},
    },
  };
  return { type: "request", requestId: id, request: requests[type] };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ConnectorCommandScheduler", () => {
  it("bounds concurrency and promotes interactive work over queued probes", async () => {
    const first = deferred();
    const order: string[] = [];
    const handle = vi.fn(async (command: HostConnectorCommand) => {
      if (command.type !== "request") return;
      order.push(command.requestId);
      if (command.requestId === "git-1") await first.promise;
    });
    const scheduler = new ConnectorCommandScheduler(handle, 1);

    scheduler.enqueue(request("git-1", "git_status"));
    scheduler.enqueue(request("git-2", "git_status"));
    scheduler.enqueue(request("catalog", "get_catalog"));
    scheduler.enqueue(request("launch", "create_session"));
    first.resolve();
    await scheduler.drain();

    expect(order).toEqual(["git-1", "launch", "catalog", "git-2"]);
  });

  it("runs independent work concurrently up to the configured limit", async () => {
    const releases = [deferred(), deferred()];
    let active = 0;
    let maximum = 0;
    const scheduler = new ConnectorCommandScheduler(async () => {
      const release = releases[active];
      active += 1;
      maximum = Math.max(maximum, active);
      await release?.promise;
      active -= 1;
    }, 2);

    scheduler.enqueue(request("git-1", "git_status"));
    scheduler.enqueue(request("git-2", "git_status"));
    await vi.waitFor(() => expect(maximum).toBe(2));
    releases[0]!.resolve();
    releases[1]!.resolve();
    await scheduler.drain();

    expect(maximum).toBe(2);
  });

  it("identifies synchronization and destructive commands as barriers", () => {
    expect(
      isConnectorCommandBarrier({
        type: "sync",
        connectionEpoch: "epoch",
        activeSessionIds: [],
      }),
    ).toBe(true);
    expect(
      isConnectorCommandBarrier({
        type: "request",
        requestId: "stop",
        request: { type: "stop_all" },
      }),
    ).toBe(true);
    expect(isConnectorCommandBarrier(request("launch", "create_session"))).toBe(
      false,
    );
  });

  it("drops pending work when closed and drains running work", async () => {
    const running = deferred();
    const order: string[] = [];
    const scheduler = new ConnectorCommandScheduler(async (command) => {
      if (command.type !== "request") return;
      order.push(command.requestId);
      await running.promise;
    }, 1);

    scheduler.enqueue(request("running", "git_status"));
    scheduler.enqueue(request("pending", "git_status"));
    scheduler.close();
    running.resolve();
    await scheduler.drain();

    expect(order).toEqual(["running"]);
  });
});
