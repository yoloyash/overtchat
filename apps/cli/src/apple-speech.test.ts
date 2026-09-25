import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APPLE_SPEECH_REVISION, appleSpeechCapabilities, appleSpeechToken, bundledSpeechUrl, prepareAppleSpeech, speechPlist, stopSpeechAgent, supportsAppleSpeech } from "./apple-speech.js";
import { runCommand, requireSuccessful } from "./process.js";
import { platformServices } from "./platform.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

vi.mock("./process.js", () => ({ runCommand: vi.fn(), requireSuccessful: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

function config(): InstallationConfig {
  return { appleSpeechPort: 18993, tts: { provider: "bundled", bundledInstalled: true, accelerator: "apple" }, stt: { provider: "bundled", bundledInstalled: true, accelerator: "cpu" } } as InstallationConfig;
}

describe("Apple speech selection", () => {
  it("requires a supported Apple Silicon OS", () => {
    expect(supportsAppleSpeech("darwin", "arm64", "23.0.0")).toBe(true);
    expect(supportsAppleSpeech("darwin", "arm64", "22.0.0")).toBe(false);
    expect(supportsAppleSpeech("darwin", "x64", "27.0.0")).toBe(false);
    expect(supportsAppleSpeech("linux", "arm64", "27.0.0")).toBe(false);
  });
  it("routes only selected native capabilities to the host", () => {
    expect(appleSpeechCapabilities(config())).toEqual(["tts"]);
    expect(bundledSpeechUrl(config(), "tts")).toBe("http://host.docker.internal:18993");
    expect(bundledSpeechUrl(config(), "stt")).toBe("http://stt:5092");
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    expect(platformServices(config()).tts.accelerator).toBe("apple");
    expect(platformServices(config()).stt.accelerator).toBe("cpu");
  });
  it("does not install anything on Linux for CPU selections", async () => {
    const value = config(); value.tts.accelerator = "cpu";
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const change = await prepareAppleSpeech(value, "secret");
    await change.commit(); await change.rollback();
  });
  it("keeps the speech token separate from the management credential", () => {
    expect(appleSpeechToken("secret")).not.toBe("secret");
    expect(appleSpeechToken("secret")).toHaveLength(64);
    expect(appleSpeechToken("other")).not.toBe(appleSpeechToken("secret"));
  });
  it("escapes service paths without a shell and starts after login", () => {
    const plist = speechPlist("test", "/Users/a & b/runtime", "/Users/a & b");
    expect(plist).toContain("a &amp; b/runtime/.venv/bin/python");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).not.toContain("/bin/sh");
  });
});

describe("native service lifecycle", () => {
  it("waits for the previous process as well as its launchd registration", async () => {
    vi.mocked(runCommand)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "\tpid = 12345\n", stderr: "" })
      .mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const kill = vi.spyOn(process, "kill").mockReturnValueOnce(true).mockImplementation(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
    await stopSpeechAgent("gui/501/owned-test");
    expect(requireSuccessful).toHaveBeenCalledWith("launchctl", ["bootout", "gui/501/owned-test"]);
    expect(kill).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenCalledTimes(3);
  });

  it("restores the previous plist when candidate bootstrap fails", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "overtchat-speech-"));
    try {
      vi.spyOn(os, "homedir").mockReturnValue(home);
      vi.spyOn(os, "release").mockReturnValue("23.0.0");
      vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
      vi.spyOn(process, "arch", "get").mockReturnValue("arm64");
      vi.spyOn(process, "getuid").mockReturnValue(501);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("not running")));
      vi.mocked(runCommand).mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
      const selected = config();
      const paths = { configDirectory: path.join(home, "config"), stackDirectory: path.join(home, "stack") } as RuntimePaths;
      const suffix = createHash("sha256").update(paths.configDirectory).digest("hex").slice(0, 12);
      const plist = path.join(home, "Library", "LaunchAgents", `com.overtchat.speech.${suffix}.plist`);
      const root = path.join(paths.stackDirectory, "apple-speech");
      const selection = createHash("sha256").update(JSON.stringify([["tts"], appleSpeechToken("secret"), 18993])).digest("hex").slice(0, 12);
      const directory = path.join(root, `${APPLE_SPEECH_REVISION}-${selection}`);
      await mkdir(path.dirname(plist), { recursive: true });
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, ".installed"), APPLE_SPEECH_REVISION);
      await writeFile(plist, "previous working service");
      let attempts = 0;
      vi.mocked(requireSuccessful).mockImplementation(async (_command, args) => {
        if (args[0] === "bootstrap" && attempts++ === 0) throw new Error("candidate failed");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      await expect(prepareAppleSpeech(selected, "secret", paths)).rejects.toThrow("candidate failed");
      expect(await readFile(plist, "utf8")).toBe("previous working service");
      expect(attempts).toBe(2);
      const cpu = { ...selected, tts: { ...selected.tts, accelerator: "cpu" as const } };
      const change = await prepareAppleSpeech(cpu, "secret", paths);
      expect(await readFile(plist, "utf8")).toBe("previous working service");
      await change.rollback();
      expect(await readFile(plist, "utf8")).toBe("previous working service");
      await change.commit();
      await expect(readFile(plist)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
