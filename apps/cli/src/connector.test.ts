import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InstallationConfig } from "./types.js";

const mocks = vi.hoisted(() => ({
  chmod: vi.fn(),
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
  runCommand: vi.fn(),
  requireSuccessful: vi.fn(),
  commandExists: vi.fn(),
}));
vi.mock("node:fs/promises", () => mocks);
vi.mock("./process.js", () => mocks);
vi.mock("node:os", () => ({
  default: {
    homedir: () => "/Users/test",
    tmpdir: () => "/tmp",
    hostname: () => "mac-test",
    userInfo: () => ({ username: "test" }),
  },
}));
import { installManagedConnector } from "./connector.js";
const config = {
  appPort: 4718,
  connectorVersion: "0.12.0",
} as InstallationConfig;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.spyOn(process, "getuid").mockReturnValue(501);
  vi.stubEnv("OVERTCHAT_CONNECTOR_BINARY", "/tmp/candidate");
  mocks.rename.mockResolvedValue(undefined);
  mocks.mkdtemp.mockResolvedValue("/tmp/staged");
  mocks.runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  mocks.requireSuccessful.mockResolvedValue({
    exitCode: 0,
    stdout: "0.12.0",
    stderr: "",
  });
  mocks.readFile.mockResolvedValue("previous binary");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url, options) =>
        new Response(
          JSON.stringify(
            options?.method === "PUT"
              ? { connectorId: "test", token: "oct_test.fixture" }
              : { connector: { online: true } },
          ),
          { status: 200 },
        ),
    ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("installs a managed Mac connector and waits for its authenticated channel", async () => {
  const onProgress = vi.fn();
  await installManagedConnector(config, "fixture-secret", { onProgress });
  expect(onProgress.mock.calls.flat()).toEqual([
    "Checking Agent Connector service support",
    "Downloading Agent Connector",
    "Checking Agent Connector executable",
    "Configuring Agent Connector connection",
    "Starting Agent Connector service",
    "Waiting for Agent Connector connection",
  ]);
  expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith("launchctl", [
    "print",
    "gui/501",
  ], { timeoutMs: 10_000 });
  expect(mocks.requireSuccessful).toHaveBeenCalledWith(
    "/Users/test/.local/bin/overtchat-connector",
    ["install-managed"],
    { timeoutMs: 120_000, input: expect.stringContaining('"connectorId":"test"') },
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("preserves the installed binary when the candidate version check fails", async () => {
  mocks.requireSuccessful.mockResolvedValue({
    exitCode: 0,
    stdout: "0.1.0",
    stderr: "",
  });
  await expect(
    installManagedConnector(config, "fixture-secret"),
  ).rejects.toThrow("version check");
  expect(mocks.rename).not.toHaveBeenCalled();
  expect(mocks.rm).not.toHaveBeenCalledWith(
    "/Users/test/.local/bin/overtchat-connector",
    expect.anything(),
  );
});

it("unloads a failed replacement and restores the previous Mac service", async () => {
  mocks.requireSuccessful.mockImplementation(async (_command, args) => {
    if (args[0] === "install-managed") throw new Error("bootstrap failed");
    return { exitCode: 0, stdout: "0.12.0", stderr: "" };
  });
  await expect(
    installManagedConnector(config, "fixture-secret"),
  ).rejects.toThrow("Starting Agent Connector service: bootstrap failed");
  expect(mocks.runCommand).toHaveBeenCalledWith("launchctl", [
    "bootout",
    "gui/501/com.overtchat.connector",
  ], { timeoutMs: 20_000 });
  expect(mocks.rename).toHaveBeenLastCalledWith(
    "/Users/test/.local/bin/overtchat-connector.previous",
    "/Users/test/.local/bin/overtchat-connector",
  );
  expect(mocks.runCommand).toHaveBeenLastCalledWith(
    "/Users/test/.local/bin/overtchat-connector",
    ["service-install"],
    { timeoutMs: 120_000 },
  );
});

it("cleans up failed downloads and reports their phase without replacing the connector", async () => {
  vi.stubEnv("OVERTCHAT_CONNECTOR_BINARY", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
  await expect(installManagedConnector(config, "fixture-secret"))
    .rejects.toThrow("Downloading Agent Connector: Could not download");
  expect(mocks.rename).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledWith("/tmp/staged", { recursive: true, force: true });
});

it("uses noninteractive permission checks and sudo when no terminal is available", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  mocks.commandExists.mockResolvedValue(true);
  mocks.runCommand.mockImplementation(async (command, args) => ({
    exitCode: command === "loginctl" && args.includes("enable-linger") ? 1 : 0,
    stdout: "", stderr: "",
  }));
  mocks.requireSuccessful.mockRejectedValueOnce(new Error("sudo: a password is required"));
  const permission = vi.fn(async (run: () => Promise<void>) => run());
  await expect(installManagedConnector(config, "fixture-secret", { interactive: false, permission }))
    .rejects.toThrow("Configuring Agent Connector background permissions: sudo: a password is required");
  expect(permission).toHaveBeenCalledOnce();
  expect(mocks.runCommand).toHaveBeenCalledWith("loginctl", ["--no-ask-password", "enable-linger", "test"], { timeoutMs: 10_000 });
  expect(mocks.requireSuccessful).toHaveBeenCalledWith("sudo", ["-n", "loginctl", "enable-linger", "test"], { inherit: true, timeoutMs: 120_000 });
  expect(mocks.mkdtemp).not.toHaveBeenCalled();
});
