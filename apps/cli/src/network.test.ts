import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { primaryLanAddress } from "./network.js";
const address = (value: string): os.NetworkInterfaceInfo => ({
  address: value,
  family: "IPv4",
  internal: false,
  netmask: "255.255.255.0",
  mac: "00:00:00:00:00:00",
  cidr: `${value}/24`,
});
afterEach(() => vi.restoreAllMocks());
it("ignores Docker and Tailscale interfaces when selecting a home network address", () => {
  vi.spyOn(os, "networkInterfaces").mockReturnValue({
    docker0: [address("172.17.0.1")],
    tailscale0: [address("100.100.1.1")],
    eth0: [address("192.168.1.20")],
  });
  expect(primaryLanAddress()).toBe("192.168.1.20");
});
it("does not mislabel a public or Tailscale address as a LAN address", () => {
  vi.spyOn(os, "networkInterfaces").mockReturnValue({
    eth0: [address("203.0.113.1")],
    tailscale0: [address("100.100.1.1")],
  });
  expect(primaryLanAddress()).toBeNull();
});
