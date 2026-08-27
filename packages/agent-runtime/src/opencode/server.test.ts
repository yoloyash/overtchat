import { PassThrough, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProcess } from "../runtime/process";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  openTcpTunnel: vi.fn(),
  spawnOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => mocks);

import { OpenCodeServerPool } from "./server";

function serverProcess(): AgentProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveExit: (value: Awaited<AgentProcess["exit"]>) => void = () => {};
  const exit = new Promise<Awaited<AgentProcess["exit"]>>((resolve) => {
    resolveExit = resolve;
  });
  const kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    resolveExit({ code: null, signal });
    return true;
  });
  return {
    stdin: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
    stdout,
    stderr,
    exit,
    kill,
  };
}

describe("OpenCode server pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts from a private neutral host directory and releases its tunnel", async () => {
    const process = serverProcess();
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.executeOnHost.mockResolvedValue({
      stdout: "/home/dev/.local/state/overtchat/opencode-home\n",
      stderr: "",
    });
    mocks.spawnOnHost.mockImplementation(() => {
      queueMicrotask(() => {
        process.stdout.emit(
          "data",
          Buffer.from("opencode server listening on http://127.0.0.1:4096\n"),
        );
      });
      return process;
    });
    mocks.openTcpTunnel.mockResolvedValue({
      url: "http://127.0.0.1:51234",
      close,
    });
    const target = {
      transport: "ssh" as const,
      alias: "workstation",
      shellMode: "login" as const,
    };

    const lease = await new OpenCodeServerPool().acquire(target, "opencode");

    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ command: "/bin/sh" }),
    );
    expect(mocks.spawnOnHost).toHaveBeenCalledWith(
      target,
      expect.objectContaining({
        command: "opencode",
        cwd: "/home/dev/.local/state/overtchat/opencode-home",
      }),
    );
    expect(lease.baseUrl).toBe("http://127.0.0.1:51234");

    await lease.release();
    expect(close).toHaveBeenCalled();
    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
