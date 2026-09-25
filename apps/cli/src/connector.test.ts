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
  },
}));
import { installManagedConnector } from "./connector.js";
const config = {
  appPort: 4718,
  connectorVersion: "0.12.0",
  agents: { installed: true },
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
  await installManagedConnector(config, "fixture-secret");
  expect(mocks.runCommand).toHaveBeenCalledExactlyOnceWith("launchctl", [
    "print",
    "gui/501",
  ]);
  expect(mocks.requireSuccessful).toHaveBeenCalledWith(
    "/Users/test/.local/bin/overtchat-connector",
    ["install-managed"],
    { input: expect.stringContaining('"connectorId":"test"') },
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
  ).rejects.toThrow("bootstrap failed");
  expect(mocks.runCommand).toHaveBeenCalledWith("launchctl", [
    "bootout",
    "gui/501/com.overtchat.connector",
  ]);
  expect(mocks.rename).toHaveBeenLastCalledWith(
    "/Users/test/.local/bin/overtchat-connector.previous",
    "/Users/test/.local/bin/overtchat-connector",
  );
  expect(mocks.runCommand).toHaveBeenLastCalledWith(
    "/Users/test/.local/bin/overtchat-connector",
    ["service-install"],
  );
});
