import { describe, expect, it, vi } from "vitest";
import {
  configureTcpTunnelOpener,
  openTcpTunnel,
} from "./process";

describe("agent TCP tunnels", () => {
  it("uses a direct loopback URL for local agents", async () => {
    const tunnel = await openTcpTunnel({ transport: "local" }, 4096);
    expect(tunnel.url).toBe("http://127.0.0.1:4096");
    await expect(tunnel.close()).resolves.toBeUndefined();
  });

  it("delegates SSH forwarding to the connector process host", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const opener = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:41234",
      close,
    });
    configureTcpTunnelOpener(opener);
    const target = { transport: "ssh" as const, alias: "macbook" };
    const tunnel = await openTcpTunnel(target, 4096);
    expect(opener).toHaveBeenCalledWith(target, 4096);
    expect(tunnel.url).toBe("http://127.0.0.1:41234");
  });

  it("rejects invalid remote ports before opening a tunnel", async () => {
    await expect(
      openTcpTunnel({ transport: "local" }, 0),
    ).rejects.toThrow("Invalid remote TCP port");
  });
});

describe("bounded host command capture", () => {
  it("preserves UTF-8 characters split across output chunks", async () => {
    const { PassThrough } = await import("node:stream");
    const { configureProcessSpawner, executeOnHost } = await import("./process");
    configureProcessSpawner(() => {
      const stdout = new PassThrough(), stderr = new PassThrough(), stdin = new PassThrough();
      const exit = new Promise<{ code: number; signal: null }>((resolve) => {
        setTimeout(() => {
          const bytes = Buffer.from("雪🙂");
          for (const byte of bytes) stdout.write(Buffer.from([byte]));
          stdout.end(); stderr.end(); resolve({ code: 0, signal: null });
        }, 0);
      });
      return { stdin, stdout, stderr, exit, kill: () => true };
    });
    expect((await executeOnHost({ transport: "local" }, { command: "unused" })).stdout).toBe("雪🙂");
  });

  it("keeps the default output limit and permits an explicit bounded transcript budget", async () => {
    const { configureLocalTestProcessSpawner } = await import("./local-process.test-helper");
    const { executeOnHost } = await import("./process");
    configureLocalTestProcessSpawner();
    const launch = { command: "node", args: ["-e", "process.stdout.write('x'.repeat(3 * 1024 * 1024))"] };
    await expect(executeOnHost({ transport: "local" }, launch)).rejects.toThrow("too much output");
    const result = await executeOnHost({ transport: "local" }, launch, { maxCaptureBytes: 4 * 1024 * 1024 });
    expect(result.stdout.length).toBe(3 * 1024 * 1024);
  });
});


it("reports an early host write rejection without an unhandled stdin error", async () => {
  const { configureLocalTestProcessSpawner } = await import("./local-process.test-helper");
  const { executeOnHost } = await import("./process");
  configureLocalTestProcessSpawner();
  await expect(executeOnHost({ transport: "local" }, {
    command: "node", args: ["-e", "process.stderr.write('write rejected'); process.exit(1)"],
  }, { stdin: "x".repeat(4 * 1024 * 1024) })).rejects.toThrow("write rejected");
});
