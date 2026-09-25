import { beforeEach, describe, expect, it, vi } from "vitest";
import { lifecycle } from "./lifecycle.js";
import {
  defaultInstallationConfig,
  readInstallationSecrets,
} from "./config.js";
import { requireDocker, runDocker } from "./docker.js";
import {
  managedDocker,
  components,
  managedInstallation,
  projectContainers,
} from "./management.js";
import { manageNative, nativeServices } from "./native-services.js";
import { runtimePaths } from "./paths.js";
import { waitForApp } from "./setup.js";
import { waitForConnector } from "./connector.js";
import manifest from "../../site/public/install-manifest.json";
vi.mock("./management.js", async (original) => ({
  ...(await original<typeof import("./management.js")>()),
  managedDocker: vi.fn(),
  managedInstallation: vi.fn(),
  projectContainers: vi.fn(),
}));
vi.mock("./config.js", async (original) => ({
  ...(await original<typeof import("./config.js")>()),
  readInstallationSecrets: vi.fn(),
}));
vi.mock("./docker.js", () => ({ requireDocker: vi.fn(), runDocker: vi.fn() }));
vi.mock("./native-services.js", () => ({
  nativeServices: vi.fn(),
  manageNative: vi.fn(),
}));
vi.mock("./setup.js", () => ({ waitForApp: vi.fn() }));
vi.mock("./connector.js", () => ({ waitForConnector: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(managedInstallation).mockResolvedValue({
    config: defaultInstallationConfig(null, manifest as never),
    paths: runtimePaths(),
  });
  vi.mocked(managedDocker).mockResolvedValue({ command: "docker", prefix: [] });
  vi.mocked(projectContainers).mockResolvedValue([]);
  vi.mocked(nativeServices).mockResolvedValue([
    { id: "connector", label: "connector", file: "/test", logs: [] },
  ]);
  vi.mocked(readInstallationSecrets).mockResolvedValue({
    managementSecret: "secret",
  });
  vi.mocked(runDocker).mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({
      services: Object.fromEntries(
        components(defaultInstallationConfig(null, manifest as never))
          .filter((component) => component.service)
          .map((component) => [component.service, { image: component.image }]),
      ),
    }),
  });
});

it("does not start or stop services when an interrupted update left different images in stack files", async () => {
  vi.mocked(runDocker).mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: '{"services":{"app":{"image":"newer-app"}}}',
  });
  await expect(lifecycle("restart")).rejects.toThrow("interrupted update");
  expect(manageNative).not.toHaveBeenCalled();
  expect(requireDocker).not.toHaveBeenCalled();
});
describe("service lifecycle", () => {
  it("starts with installed images and verifies app before connector", async () => {
    await lifecycle("start");
    expect(requireDocker).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["up", "-d", "--pull", "never"]),
      { inherit: true },
    );
    expect(vi.mocked(waitForApp).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(manageNative).mock.invocationCallOrder[0]!,
    );
    expect(waitForConnector).toHaveBeenCalledOnce();
  });
  it("stops native services before containers, retaining volumes", async () => {
    await lifecycle("stop");
    expect(manageNative).toHaveBeenCalledWith(expect.anything(), "stop");
    expect(vi.mocked(manageNative).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(requireDocker).mock.invocationCallOrder[0]!,
    );
    expect(requireDocker).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.arrayContaining(["--profile", "*", "stop"]),
      { inherit: true },
    );
    expect(waitForApp).not.toHaveBeenCalled();
  });
  it("restarts without pulling or provisioning", async () => {
    await lifecycle("restart");
    expect(
      vi.mocked(manageNative).mock.calls.map(([, action]) => action),
    ).toEqual(["stop", "start"]);
    expect(vi.mocked(requireDocker).mock.calls).toHaveLength(2);
  });
  it("does not start the connector if app readiness fails", async () => {
    vi.mocked(waitForApp).mockRejectedValueOnce(new Error("not ready"));
    await expect(lifecycle("start")).rejects.toThrow("not ready");
    expect(manageNative).not.toHaveBeenCalled();
  });
});
