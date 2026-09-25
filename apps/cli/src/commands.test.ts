import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, parseArgs, usage } from "./commands.js";
import { CLI_VERSION } from "./constants.js";
import { readInstallationConfig } from "./config.js";
import { latestReleaseManifest, updateCliIfNeeded } from "./release.js";
import { setup } from "./setup.js";
import { status } from "./status.js";
vi.mock("./config.js", async (original) => ({
  ...(await original<typeof import("./config.js")>()),
  readInstallationConfig: vi.fn(),
}));
vi.mock("./release.js", async (original) => ({
  ...(await original<typeof import("./release.js")>()),
  latestReleaseManifest: vi.fn(),
  updateCliIfNeeded: vi.fn(),
}));
vi.mock("./setup.js", () => ({ setup: vi.fn(), waitForApp: vi.fn() }));
vi.mock("./status.js", () => ({ status: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("CLI contract", () => {
  it.each([
    "setup",
    "update",
    "status",
    "version",
    "logs",
  ])(
    "supports %s --help without loading installation state",
    async (command) => {
      await main([command, "--help"]);
      expect(console.log).toHaveBeenCalledWith(usage(command));
      expect(readInstallationConfig).not.toHaveBeenCalled();
      expect(latestReleaseManifest).not.toHaveBeenCalled();
    },
  );
  it.each(["version", "--version", "-v"])(
    "keeps bare version machine-readable: %j",
    async (args) => {
      await main([args]);
      expect(console.log).toHaveBeenCalledExactlyOnceWith(CLI_VERSION);
      expect(readInstallationConfig).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["version", "--typo"],
    ["status", "extra"],
    ["restart", "--yes"],
    ["logs", "--tail", "-1"],
    ["logs", "--tail"],
    ["update", "--json"],
    ["help", "setup", "extra"],
  ])("rejects invalid arguments %j", (...args) => {
    expect(() => parseArgs(args)).toThrow();
  });
  it("parses service logs and zero tail", () => {
    expect(parseArgs(["logs", "connector", "--tail", "0", "-f"])).toMatchObject(
      { service: "connector", tail: 0, flags: new Set(["--tail", "-f"]) },
    );
  });
  it("shows overview without reconfiguring an existing installation", async () => {
    vi.mocked(readInstallationConfig).mockResolvedValue({ format: 1 } as never);
    await main([]);
    expect(status).toHaveBeenCalledOnce();
    expect(setup).not.toHaveBeenCalled();
  });
  it("keeps setup release selection and CLI self-update behavior", async () => {
    const manifest = { cliVersion: "99.0.0" } as never;
    vi.mocked(latestReleaseManifest).mockResolvedValue(manifest);
    vi.mocked(updateCliIfNeeded).mockResolvedValue(null);
    await main(["setup", "--defaults"]);
    expect(latestReleaseManifest).toHaveBeenCalledOnce();
    expect(updateCliIfNeeded).toHaveBeenCalledWith(manifest);
    expect(setup).toHaveBeenCalledWith(
      { dryRun: false, defaults: true, development: false }, manifest,
    );
  });
  it.each(["doctor", "start", "stop", "restart", "uninstall"])(
    "rejects deferred command %s", (command) => {
      expect(() => parseArgs([command])).toThrow("Unknown command");
    },
  );
});
