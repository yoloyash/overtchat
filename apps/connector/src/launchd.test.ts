import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
}));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  chmod: mocks.chmod,
}));
import {
  assertLaunchAgentAvailable,
  installLaunchAgent,
  launchAgentPlist,
} from "./launchd.js";

beforeEach(() => {
  vi.spyOn(process, "getuid").mockReturnValue(501);
  mocks.exec.mockReset().mockResolvedValue({ stdout: "", stderr: "" });
  mocks.writeFile.mockClear();
});
afterEach(() => vi.restoreAllMocks());

it("escapes plist arguments and preserves PATH without copying credentials", () => {
  const plist = launchAgentPlist(
    ["/Users/A & B/bin/connector", "run"],
    "/Users/A & B",
    {
      PATH: "/custom/bin",
      SECRET_TOKEN: "must-not-copy",
      OVERTCHAT_CONNECTOR_CONFIG: "/tmp/test/config.json",
    },
  );
  expect(plist).toContain("/Users/A &amp; B/bin/connector");
  expect(plist).toContain("/custom/bin:");
  expect(plist).toContain("/opt/homebrew/bin");
  expect(plist).toContain("/tmp/test/config.json");
  expect(plist).not.toContain("must-not-copy");
  expect(plist).toContain("<key>KeepAlive</key><true/>");
});

it("requires a desktop login without falling back to a privileged daemon", async () => {
  mocks.exec.mockRejectedValue(new Error("No GUI domain"));
  await expect(assertLaunchAgentAvailable()).rejects.toThrow(
    "logged-in macOS desktop session",
  );
});

it("unloads an existing agent before bootstrapping its replacement", async () => {
  mocks.exec
    .mockResolvedValueOnce({ stdout: "" })
    .mockResolvedValueOnce({ stdout: "pid = 1234" })
    .mockResolvedValueOnce({ stdout: "" })
    .mockRejectedValueOnce(new Error("Not loaded"));
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("Gone"), { code: "ESRCH" });
  });
  await installLaunchAgent([
    "/Users/test/.local/bin/overtchat-connector",
    "run",
  ]);
  expect(kill).toHaveBeenCalledWith(1234, 0);
  expect(mocks.exec.mock.calls.map((call) => call[1][0])).toEqual([
    "print",
    "print",
    "bootout",
    "print",
    "enable",
    "bootstrap",
  ]);
  expect(mocks.exec).toHaveBeenCalledWith("launchctl", [
    "bootout",
    "gui/501/com.overtchat.connector",
  ]);
  expect(mocks.writeFile).toHaveBeenCalledWith(
    expect.stringContaining(
      "Library/LaunchAgents/com.overtchat.connector.plist",
    ),
    expect.stringContaining("<key>ProgramArguments</key>"),
    { mode: 0o600 },
  );
});

it("bootstraps a fresh agent when no previous job exists", async () => {
  mocks.exec.mockImplementation(async (_command, args) => {
    if (args[0] === "print" && args[1].endsWith("/com.overtchat.connector"))
      throw new Error("Not loaded");
    return { stdout: "", stderr: "" };
  });
  await installLaunchAgent([
    "/Users/test/.local/bin/overtchat-connector",
    "run",
  ]);
  expect(mocks.exec.mock.calls.map((call) => call[1][0])).toEqual([
    "print",
    "print",
    "enable",
    "bootstrap",
  ]);
});
