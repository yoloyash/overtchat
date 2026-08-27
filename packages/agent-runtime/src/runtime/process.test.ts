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
