import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { logs } from "./logs.js";
import { defaultInstallationConfig } from "./config.js";
import { requireDocker } from "./docker.js";
import { managedDocker, managedInstallation } from "./management.js";
import { requireSuccessful } from "./process.js";
import { runtimePaths } from "./paths.js";
import manifest from "../../site/public/install-manifest.json";
vi.mock("./management.js", async (original) => ({
  ...(await original<typeof import("./management.js")>()),
  managedDocker: vi.fn(),
  managedInstallation: vi.fn(),
}));
vi.mock("./docker.js", () => ({ requireDocker: vi.fn() }));
vi.mock("./process.js", () => ({ requireSuccessful: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(managedInstallation).mockResolvedValue({
    config: defaultInstallationConfig(null, manifest as never),
    paths: runtimePaths(),
  });
  vi.mocked(managedDocker).mockResolvedValue({ command: "docker", prefix: [] });
});
it("maps friendly service names to Compose services and forwards follow/tail", async () => {
  await logs("search", true, 23);
  expect(requireDocker).toHaveBeenCalledWith(
    expect.anything(),
    expect.arrayContaining(["logs", "--tail", "23", "--follow", "searxng"]),
    { inherit: true },
  );
});
it("rejects disabled or unknown services before running Docker", async () => {
  await expect(logs("voice", false, 100)).rejects.toThrow("uninstalled");
  expect(requireDocker).not.toHaveBeenCalled();
});
it("reads native file logs without requiring Docker", async () => {
  const installation = await managedInstallation();
  installation.config.tts = { provider: "bundled", bundledInstalled: true, accelerator: "apple" };
  await logs("speech", true, 40);
  expect(requireSuccessful).toHaveBeenCalledWith(
    "tail",
    ["-n", "40", "-F", expect.stringContaining("/apple-speech/speech.log")],
    { inherit: true },
  );
  expect(managedDocker).not.toHaveBeenCalled();
});


it("reads Linux connector logs even when Docker is unavailable", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  const installation = await managedInstallation();
  installation.config.agents.installed = true;
  await logs("connector", true, 0);
  expect(requireSuccessful).toHaveBeenCalledWith(
    "journalctl",
    ["--user", "-u", "overtchat-connector.service", "--no-pager", "-n", "0", "-f"],
    { inherit: true },
  );
  expect(managedDocker).not.toHaveBeenCalled();
});
it("reads both macOS connector logs without inspecting or controlling its service", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  const installation = await managedInstallation();
  installation.config.agents.installed = true;
  await logs("connector", false, 25);
  expect(requireSuccessful).toHaveBeenCalledWith(
    "tail",
    ["-n", "25", expect.stringContaining("/OvertChat/connector.log"),
      expect.stringContaining("/OvertChat/connector.error.log")],
    { inherit: true },
  );
  expect(managedDocker).not.toHaveBeenCalled();
});
