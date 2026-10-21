import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InstallationConfig } from "./types.js";
import { BinaryUpdate } from "./binary-update.js";
import { ProcessLock } from "./process-lock.js";
import { installManagedConnector } from "./connector.js";

const mocks = vi.hoisted(() => ({ runCommand: vi.fn(), requireSuccessful: vi.fn(), commandExists: vi.fn() }));
vi.mock("./process.js", () => mocks);
let root: string;
let installed: string;
let configFile: string;
const config = { appPort: 4718, connectorVersion: "0.12.0" } as InstallationConfig;
const credentials = { serverUrl: "http://127.0.0.1:4718", connectorId: "test", token: "oct_test.fixture" };
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "connector-update-"));
  installed = path.join(root, "overtchat-connector");
  configFile = path.join(root, "connector.json");
  await writeFile(installed, "previous binary");
  await writeFile(path.join(root, "candidate"), "candidate binary");
  await writeFile(configFile, JSON.stringify(credentials));
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.spyOn(process, "getuid").mockReturnValue(501);
  vi.stubEnv("OVERTCHAT_BIN_DIR", root);
  vi.stubEnv("OVERTCHAT_CONNECTOR_BINARY", path.join(root, "candidate"));
  vi.stubEnv("OVERTCHAT_CONNECTOR_CONFIG", configFile);
  mocks.runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  mocks.requireSuccessful.mockResolvedValue({ exitCode: 0, stdout: "0.12.0", stderr: "" });
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => Response.json(options?.method === "PUT"
    ? { connectorId: "test", token: "oct_test.new" } : { connector: { id: "test", online: true, version: "0.12.0" } })));
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

it("reuses credentials without provisioning or rotating the server token", async () => {
  await installManagedConnector(config, "fixture-secret");
  expect(await readFile(installed, "utf8")).toBe("candidate binary");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "PUT")).toBe(true);
  expect(mocks.requireSuccessful).toHaveBeenCalledWith(installed, ["install-managed"], expect.objectContaining({
    input: `${JSON.stringify(credentials)}\n`,
  }));
  await expect(stat(`${installed}.update.json`)).rejects.toMatchObject({ code: "ENOENT" });
});

it("provisions only an unpaired installation", async () => {
  await rm(configFile);
  await installManagedConnector(config, "fixture-secret");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(mocks.requireSuccessful).toHaveBeenCalledWith(installed, ["install-managed"], expect.objectContaining({
    input: expect.stringContaining('"token":"oct_test.new"'),
  }));
});

it("preserves the installed binary and pairing on invalid candidate or malformed config", async () => {
  mocks.requireSuccessful.mockResolvedValue({ exitCode: 0, stdout: "0.1.0", stderr: "" });
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("version check");
  expect(await readFile(installed, "utf8")).toBe("previous binary");
  await writeFile(configFile, "incomplete JSON");
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("Invalid connector configuration");
  expect(fetch).not.toHaveBeenCalled();
});

it("restores the previous binary and verifies reconnection after startup fails", async () => {
  mocks.requireSuccessful.mockImplementation(async (_command, args) => {
    if (args[0] === "install-managed") throw new Error("bootstrap failed");
    return { exitCode: 0, stdout: "0.12.0", stderr: "" };
  });
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("bootstrap failed");
  expect(await readFile(installed, "utf8")).toBe("previous binary");
  expect(JSON.parse(await readFile(configFile, "utf8"))).toEqual(credentials);
  expect(mocks.requireSuccessful).toHaveBeenCalledWith(installed, ["service-install"], expect.anything());
  expect(fetch).toHaveBeenCalledOnce();
  await expect(stat(`${installed}.update.json`)).rejects.toMatchObject({ code: "ENOENT" });
});

it("reports rollback restart failure and retains recovery state for a later retry", async () => {
  mocks.requireSuccessful.mockImplementation(async (_command, args) => {
    if (args[0] === "install-managed") throw new Error("bootstrap failed");
    if (args[0] === "service-install") throw new Error("old service restart failed");
    return { exitCode: 0, stdout: "0.12.0", stderr: "" };
  });
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("Recovery failed: old service restart failed");
  expect(await readFile(installed, "utf8")).toBe("previous binary");
  expect(JSON.parse(await readFile(`${installed}.update.json`, "utf8")).committed).toBe(false);
  mocks.requireSuccessful.mockResolvedValue({ exitCode: 0, stdout: "0.12.0", stderr: "" });
  await installManagedConnector(config, "fixture-secret");
  expect(await readFile(installed, "utf8")).toBe("candidate binary");
});

it("retains recovery state if rollback starts but never reconnects", async () => {
  mocks.requireSuccessful.mockImplementation(async (_command, args) => {
    if (args[0] === "install-managed") throw new Error("bootstrap failed");
    return { exitCode: 0, stdout: "0.12.0", stderr: "" };
  });
  // Expire readiness immediately without a 45-second wall-clock test.
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now += 60_000);
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("Recovery failed: The Agent Connector service started but did not come online");
  expect(await readFile(installed, "utf8")).toBe("previous binary");
  expect(await stat(`${installed}.update.json`)).toBeDefined();
});

it("recovers an interrupted replacement before starting a new update", async () => {
  const transaction = new BinaryUpdate(installed);
  await transaction.prepare(path.join(root, "candidate"));
  await transaction.replace();
  mocks.requireSuccessful.mockImplementation(async (command, args) => {
    if (command === installed && args[0] === "service-install")
      expect(await readFile(installed, "utf8")).toBe("previous binary");
    return { exitCode: 0, stdout: "0.12.0", stderr: "" };
  });
  await installManagedConnector(config, "fixture-secret");
  expect(mocks.requireSuccessful.mock.calls[0][1]).toEqual(["service-install"]);
  expect(await readFile(installed, "utf8")).toBe("candidate binary");
});

it("rejects a concurrent connector update before touching installation state", async () => {
  const lock = await ProcessLock.acquire(`${installed}.update.lock`);
  try {
    await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("Another OvertChat installation operation");
    expect(mocks.requireSuccessful).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally { await lock.release(); }
});

it("stages a complete Windows candidate before stopping the old service", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  installed += ".exe";
  await writeFile(installed, "previous binary");
  mocks.requireSuccessful.mockImplementation(async (_command, args) => {
    if (args[0] === "service-stop") {
      expect(await readFile(`${installed}.next`, "utf8")).toBe("candidate binary");
      expect(await stat(`${installed}.update.json`)).toBeDefined();
    }
    return { exitCode: 0, stdout: "0.12.0", stderr: "" };
  });
  await installManagedConnector(config, "fixture-secret");
  expect(await readFile(installed, "utf8")).toBe("candidate binary");
});

it("does not stop a healthy service when candidate staging fails", async () => {
  await mkdir(`${installed}.next`);
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow();
  expect(await readFile(installed, "utf8")).toBe("previous binary");
  expect(mocks.requireSuccessful.mock.calls.map(([, args]) => args[0])).toEqual(["version"]);
  expect(fetch).not.toHaveBeenCalled();
});

it("retains the replacement, backup, and journal if Windows rollback cannot stop the service", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  installed += ".exe";
  await writeFile(installed, "previous binary");
  let stops = 0;
  mocks.requireSuccessful.mockImplementation(async (_command, args) => {
    if (args[0] === "install-managed") throw new Error("startup failed after task registration");
    if (args[0] === "service-stop" && ++stops > 1) throw new Error("replacement did not stop");
    return { exitCode: 0, stdout: "0.12.0", stderr: "" };
  });
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("startup failed after task registration. Recovery failed: replacement did not stop");
  expect(await readFile(installed, "utf8")).toBe("candidate binary");
  expect(await readFile(`${installed}.previous`, "utf8")).toBe("previous binary");
  expect(await stat(`${installed}.update.json`)).toBeDefined();
});

it("reports download failures before changing the installed connector", async () => {
  vi.stubEnv("OVERTCHAT_CONNECTOR_BINARY", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
  await expect(installManagedConnector(config, "fixture-secret")).rejects.toThrow("Downloading Agent Connector: Could not download");
  expect(await readFile(installed, "utf8")).toBe("previous binary");
  expect(mocks.requireSuccessful).not.toHaveBeenCalled();
});

it("uses noninteractive Linux permission checks before changing the connector", async () => {
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
  expect(mocks.requireSuccessful).toHaveBeenCalledWith("sudo", ["-n", "loginctl", "enable-linger", expect.any(String)], { inherit: true, timeoutMs: 120_000 });
  expect(await readFile(installed, "utf8")).toBe("previous binary");
});
