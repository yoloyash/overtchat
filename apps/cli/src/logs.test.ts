import { beforeEach, expect, it, vi } from "vitest";
import { logs } from "./logs.js";
import { defaultInstallationConfig } from "./config.js";
import { requireDocker } from "./docker.js";
import { managedDocker, managedInstallation } from "./management.js";
import { nativeServices } from "./native-services.js";
import { requireSuccessful } from "./process.js";
import { runtimePaths } from "./paths.js";
import manifest from "../../site/public/install-manifest.json";
vi.mock("./management.js", async (original) => ({
  ...(await original<typeof import("./management.js")>()),
  managedDocker: vi.fn(),
  managedInstallation: vi.fn(),
}));
vi.mock("./docker.js", () => ({ requireDocker: vi.fn() }));
vi.mock("./native-services.js", () => ({ nativeServices: vi.fn() }));
vi.mock("./process.js", () => ({ requireSuccessful: vi.fn() }));
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
  vi.mocked(nativeServices).mockResolvedValue([
    {
      id: "speech",
      label: "speech",
      file: "/speech.plist",
      logs: ["/speech.log"],
    },
  ]);
  await logs("speech", true, 40);
  expect(requireSuccessful).toHaveBeenCalledWith(
    "tail",
    ["-n", "40", "-F", "/speech.log"],
    { inherit: true },
  );
  expect(managedDocker).not.toHaveBeenCalled();
});
