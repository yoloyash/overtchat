import { PassThrough } from "node:stream";
import type { AgentProcess, AgentProcessExit } from "@overtchat/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferredProcess } from "./deferred-process.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  let finish!: (exit: AgentProcessExit) => void;
  const child: AgentProcess = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exit: new Promise((resolve) => {
      finish = resolve;
    }),
    kill: vi.fn(() => true),
  };
  return { child, finish };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("deferred process cancellation", () => {
  it("preserves signals and repeated escalation after startup", async () => {
    const { child, finish } = fixture();
    const handle = deferredProcess(async () => child);
    await flush();
    handle.kill("SIGTERM");
    handle.kill("SIGKILL");
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    finish({ code: null, signal: "SIGKILL" });
    await handle.exit;
  });
  it("waits for exit and escalates when graceful termination is ignored", async () => {
    vi.useFakeTimers();
    const { child, finish } = fixture();
    const handle = deferredProcess(async () => child);
    await flush();
    let stopped = false;
    const stopping = handle.terminate!().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(stopped).toBe(false);
    finish({ code: null, signal: "SIGKILL" });
    await stopping;
    expect(stopped).toBe(true);
  });
  it("retains a forced signal while startup is pending without delivering buffered input", async () => {
    const { child, finish } = fixture();
    let launch!: (child: AgentProcess) => void;
    const handle = deferredProcess(
      () =>
        new Promise((resolve) => {
          launch = resolve;
        }),
    );
    handle.stdin.write("must not execute");
    await flush();
    handle.kill("SIGKILL");
    handle.kill("SIGTERM");
    launch(child);
    await flush();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(child.stdin.writableLength).toBe(0);
    expect((child.stdin as PassThrough).readableLength).toBe(0);
    finish({ code: null, signal: "SIGKILL" });
    await handle.exit;
  });
  it("cleans up a process that finishes startup after cancellation", async () => {
    const { child, finish } = fixture();
    child.terminate = vi.fn(async () => {
      finish({ code: 0, signal: null });
    });
    let launch!: (child: AgentProcess) => void;
    const handle = deferredProcess(
      () =>
        new Promise((resolve) => {
          launch = resolve;
        }),
    );
    await flush();
    const stopping = handle.terminate!();
    launch(child);
    await stopping;
    expect(child.terminate).toHaveBeenCalledOnce();
    await handle.exit;
  });
  it("settles termination when an aborted probe never creates a process", async () => {
    const handle = deferredProcess(async (signal) => {
      signal.throwIfAborted();
      throw Error("unused");
    });
    await handle.terminate!();
    expect((await handle.exit).error?.name).toBe("AbortError");
  });
});
