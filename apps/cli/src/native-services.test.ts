import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultInstallationConfig } from "./config.js";
import { nativeServices, manageNative } from "./native-services.js";
import { requireSuccessful, runCommand } from "./process.js";
import { runtimePaths } from "./paths.js";
import manifest from "../../site/public/install-manifest.json";
vi.mock("./process.js", () => ({
  requireSuccessful: vi.fn(),
  runCommand: vi.fn(),
}));
let directory: string;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-native-"));
  vi.spyOn(os, "homedir").mockReturnValue(directory);
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  vi.mocked(runCommand).mockResolvedValue({
    stdout: "",
    stderr: "",
    exitCode: 1,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
async function connector(serverUrl = "http://127.0.0.1:4718") {
  const config = {
    ...defaultInstallationConfig(null, manifest as never),
    agents: { installed: true },
  };
  await mkdir(path.join(directory, ".config", "overtchat"), {
    recursive: true,
  });
  await writeFile(
    path.join(directory, ".config", "overtchat", "connector.json"),
    JSON.stringify({ serverUrl }),
  );
  return config;
}
describe("native service control", () => {
  it("refuses to stop a connector paired to another server", async () => {
    const config = await connector("https://another-server.example.com");
    await expect(nativeServices(config, runtimePaths())).rejects.toThrow(
      "another server",
    );
    expect(requireSuccessful).not.toHaveBeenCalled();
  });
  it("refuses an unmanaged connector executable in the unit", async () => {
    const config = await connector();
    const file = path.join(
      directory,
      ".config",
      "systemd",
      "user",
      "overtchat-connector.service",
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "ExecStart=/some/other/connector run");
    await expect(nativeServices(config, runtimePaths())).rejects.toThrow(
      "unmanaged executable",
    );
  });
  it("disables and unregisters only the selected systemd service", async () => {
    const file = path.join(directory, "connector.service");
    await writeFile(file, "service");
    await manageNative(
      { id: "connector", label: "overtchat-connector.service", file, logs: [] },
      "remove",
    );
    expect(requireSuccessful).toHaveBeenNthCalledWith(1, "systemctl", [
      "--user",
      "disable",
      "--now",
      "overtchat-connector.service",
    ]);
    expect(requireSuccessful).toHaveBeenNthCalledWith(2, "systemctl", [
      "--user",
      "daemon-reload",
    ]);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("bootstraps an unloaded LaunchAgent without rewriting its configuration", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const file = path.join(directory, "speech.plist");
    await writeFile(file, "original plist");
    await manageNative(
      { id: "speech", label: "com.overtchat.speech.test", file, logs: [] },
      "start",
    );
    expect(requireSuccessful).toHaveBeenCalledWith("launchctl", [
      "bootstrap",
      `gui/${process.getuid!()}`,
      file,
    ]);
    expect(await readFile(file, "utf8")).toBe("original plist");
  });
  it("does not bootstrap a LaunchAgent already registered", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.mocked(runCommand).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const file = path.join(directory, "speech.plist");
    await writeFile(file, "original plist");
    await manageNative(
      { id: "speech", label: "com.overtchat.speech.test", file, logs: [] },
      "start",
    );
    expect(
      vi
        .mocked(requireSuccessful)
        .mock.calls.some(([, args]) => args.includes("bootstrap")),
    ).toBe(false);
  });
});
