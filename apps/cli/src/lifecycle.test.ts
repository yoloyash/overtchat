import { beforeEach, expect, it, vi } from "vitest";
import { lifecycle } from "./lifecycle.js";
import { defaultInstallationConfig } from "./config.js";
import {
  detectDockerCommand,
  dockerComposeAvailable,
  requireDocker,
} from "./docker.js";
import { composeArgs, managedInstallation } from "./management.js";
import { runtimePaths } from "./paths.js";
import { waitForApp } from "./setup.js";
import manifest from "../../site/public/install-manifest.json";
vi.mock("./management.js", async (original) => ({
  ...(await original<typeof import("./management.js")>()),
  managedInstallation: vi.fn(),
}));
vi.mock("./docker.js", () => ({
  detectDockerCommand: vi.fn(),
  dockerComposeAvailable: vi.fn(),
  requireDocker: vi.fn(),
}));
vi.mock("./setup.js", () => ({ waitForApp: vi.fn() }));
const paths = runtimePaths();
const config = { ...defaultInstallationConfig(null, manifest as never), appPort: 4999 };
const composeCalls = () =>
  vi.mocked(requireDocker).mock.calls.map(([, args]) => args.slice(composeArgs(paths).length));
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(managedInstallation).mockResolvedValue({ config, paths });
  vi.mocked(detectDockerCommand).mockResolvedValue({ command: "docker", prefix: [] });
  vi.mocked(dockerComposeAvailable).mockResolvedValue(true);
});
it("stops the managed stack without waiting for the app", async () => {
  await lifecycle("stop");
  expect(requireDocker).toHaveBeenCalledExactlyOnceWith(
    { command: "docker", prefix: [] },
    [...composeArgs(paths), "stop"],
    { inherit: true },
  );
  expect(waitForApp).not.toHaveBeenCalled();
});
it("starts the managed stack and waits for the app", async () => {
  await lifecycle("start");
  expect(composeCalls()).toEqual([["up", "-d"]]);
  expect(waitForApp).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:4999");
});
it("restarts by stopping first, then starting and waiting for the app", async () => {
  await lifecycle("restart");
  expect(composeCalls()).toEqual([["stop"], ["up", "-d"]]);
  expect(waitForApp).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:4999");
});
it("does not start the stack when stopping it fails", async () => {
  vi.mocked(requireDocker).mockRejectedValueOnce(new Error("stop failed"));
  await expect(lifecycle("restart")).rejects.toThrow("stop failed");
  expect(composeCalls()).toEqual([["stop"]]);
  expect(waitForApp).not.toHaveBeenCalled();
});
it("reports an app that never becomes ready", async () => {
  vi.mocked(waitForApp).mockRejectedValueOnce(new Error("OvertChat did not become ready within three minutes."));
  await expect(lifecycle("start")).rejects.toThrow("did not become ready");
});
it.each([
  ["Docker is missing", null, true],
  ["Compose is missing", { command: "docker", prefix: [] }, false],
])("requires Docker Compose: %s", async (_name, docker, compose) => {
  vi.mocked(detectDockerCommand).mockResolvedValue(docker);
  vi.mocked(dockerComposeAvailable).mockResolvedValue(compose);
  await expect(lifecycle("stop")).rejects.toThrow("Docker Compose v2");
  expect(requireDocker).not.toHaveBeenCalled();
});
it("requires a managed installation before touching Docker", async () => {
  vi.mocked(managedInstallation).mockRejectedValue(new Error("OvertChat is not managed yet. Run overtchat setup first."));
  await expect(lifecycle("start")).rejects.toThrow("not managed yet");
  expect(detectDockerCommand).not.toHaveBeenCalled();
});
