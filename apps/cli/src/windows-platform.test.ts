import { afterEach, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { runtimePaths } from "./paths.js";
import { primaryLanAddress } from "./network.js";
import { commandExists } from "./process.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("keeps managed Windows data in LocalAppData and honors isolated directories", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const root = path.join(os.tmpdir(), "Some User", "Local");
  expect(runtimePaths({ LOCALAPPDATA: root }).configDirectory).toBe(path.join(root, "OvertChat", "config"));
  expect(runtimePaths({ LOCALAPPDATA: root }).stackDirectory).toBe(path.join(root, "OvertChat", "stack"));
  expect(runtimePaths({ LOCALAPPDATA: root, OVERTCHAT_HOME: "/isolated" }).configDirectory)
    .toBe(path.join("/isolated", "OvertChat", "config"));
  expect(runtimePaths({ OVERTCHAT_CONFIG_DIR: "/config", OVERTCHAT_STACK_DIR: "/stack" }))
    .toMatchObject({ configDirectory: "/config", stackDirectory: "/stack" });
});

it("does not advertise the Docker/WSL virtual adapter to phones", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const address = (value: string) => ({ address: value, netmask: "255.255.255.0", family: "IPv4" as const, mac: "", internal: false, cidr: `${value}/24` });
  vi.spyOn(os, "networkInterfaces").mockReturnValue({
    "vEthernet (WSL)": [address("172.29.0.1")],
    Tailscale: [address("100.100.0.1")],
    Ethernet: [address("192.168.1.50")],
  });
  expect(primaryLanAddress()).toBe("192.168.1.50");
});

it("discovers Windows executables without running a shell or accepting script shims", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-command-"));
  try {
    await writeFile(path.join(directory, "example.exe"), "fixture");
    await writeFile(path.join(directory, "only-script.cmd"), "fixture");
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("PATH", directory);
    expect(await commandExists("example")).toBe(true);
    expect(await commandExists("only-script")).toBe(false);
    expect(await commandExists("missing-overtchat-test-command")).toBe(false);
    expect(await commandExists(path.join(directory, "example.exe"))).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
