import http from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProcess } from "../runtime/process";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  openTcpTunnel: vi.fn(),
  spawnManagedOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/process")>()),
  ...mocks,
}));

import { OpenCodeServerPool } from "./server";

function serverProcess(ignoreTerm = false): AgentProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveExit: (value: Awaited<AgentProcess["exit"]>) => void = () => {};
  const exit = new Promise<Awaited<AgentProcess["exit"]>>((resolve) => {
    resolveExit = resolve;
  });
  const kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    if (ignoreTerm && signal === "SIGTERM") return true;
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
    mocks.executeOnHost.mockResolvedValue({
      stdout: "/tmp/overtchat-opencode-home\n",
      stderr: "",
    });
    mocks.openTcpTunnel.mockResolvedValue({
      url: "http://127.0.0.1:4096",
      close: vi.fn().mockResolvedValue(undefined),
    });
  });
  afterEach(() => vi.useRealTimers());

  it("keeps a shared server alive until its final lease is released", async () => {
    const process = serverProcess();
    mocks.spawnManagedOnHost.mockImplementation(() => {
      setTimeout(
        () =>
          process.stdout.emit(
            "data",
            "opencode server listening on http://127.0.0.1:4096\n",
          ),
        0,
      );
      return process;
    });
    const pool = new OpenCodeServerPool();
    const [first, second] = await Promise.all([
      pool.acquire({ transport: "local" }, "opencode"),
      pool.acquire({ transport: "local" }, "opencode"),
    ]);
    expect(mocks.spawnManagedOnHost).toHaveBeenCalledOnce();
    await first.release();
    await first.release();
    expect(process.kill).not.toHaveBeenCalled();
    await second.release();
    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("ends a server's connections when its final lease is released", async () => {
    const requests: string[] = [];
    const sockets = new Set<import("node:net").Socket>();
    const backend = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        requests.push(
          `${request.method} ${request.url} ${request.headers["content-length"] ?? "-"} ${body}`,
        );
        response.end("ok");
      });
    });
    backend.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    const process = serverProcess();
    mocks.spawnManagedOnHost.mockImplementation(() => {
      setTimeout(() =>
        process.stdout.emit(
          "data",
          "opencode server listening on http://127.0.0.1:4096\n",
        ),
      );
      return process;
    });
    mocks.openTcpTunnel.mockResolvedValue({
      url,
      close: vi.fn().mockResolvedValue(undefined),
    });

    try {
      const lease = await new OpenCodeServerPool().acquire(
        { transport: "local" },
        "opencode",
      );
      // The SDK hands its fetch one prepared Request.
      const read = await lease.fetch(new Request(`${url}/session?roots=true`));
      expect(await read.text()).toBe("ok");
      const write = await lease.fetch(
        new Request(`${url}/session`, { method: "POST", body: '{"title":"x"}' }),
      );
      expect(write.status).toBe(200);
      expect(requests).toEqual([
        "GET /session?roots=true - ",
        'POST /session 13 {"title":"x"}',
      ]);
      // Connections are kept for later requests while the server lives.
      expect(sockets.size).toBeGreaterThan(0);

      await lease.release();
      await vi.waitFor(() => expect(sockets.size).toBe(0));
      await expect(lease.fetch(new Request(`${url}/session`))).rejects.toThrow();
    } finally {
      await new Promise((resolve) => backend.close(resolve));
    }
  });

  it.each(["startup timeout", "tunnel failure"])(
    "escalates cleanup after %s",
    async (failure) => {
      vi.useFakeTimers();
      const process = serverProcess(true);
      mocks.spawnManagedOnHost.mockImplementation(() => {
        if (failure === "tunnel failure") {
          setTimeout(
            () =>
              process.stdout.emit(
                "data",
                "opencode server listening on http://127.0.0.1:4096\n",
              ),
            0,
          );
        }
        return process;
      });
      mocks.openTcpTunnel.mockRejectedValue(new Error("tunnel unavailable"));
      const started = new OpenCodeServerPool().acquire(
        { transport: "local" },
        "opencode",
      );
      const failed = expect(started).rejects.toThrow(
        failure === "startup timeout"
          ? "did not become ready"
          : "tunnel unavailable",
      );
      await vi.advanceTimersByTimeAsync(31_001);
      await failed;
      expect(process.kill).toHaveBeenCalledWith("SIGTERM");
      expect(process.kill).toHaveBeenCalledWith("SIGKILL");
    },
  );

  it("starts from a private neutral host directory and releases its tunnel", async () => {
    const process = serverProcess();
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.executeOnHost.mockResolvedValue({
      stdout: "/home/dev/.local/state/overtchat/opencode-home\n",
      stderr: "",
    });
    mocks.spawnManagedOnHost.mockImplementation(() => {
      setTimeout(() => {
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
      expect.objectContaining({ command: "node" }),
    );
    expect(mocks.spawnManagedOnHost).toHaveBeenCalledWith(
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
