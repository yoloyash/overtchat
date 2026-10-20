import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commandEnvironment,
  platformServices,
  releaseAsset,
} from "./platform.js";
import type { InstallationConfig } from "./types.js";

afterEach(() => vi.restoreAllMocks());

describe("release platform selection", () => {
  it.each([
    ["linux", "x64", "linux-amd64"],
    ["linux", "arm64", "linux-arm64"],
    ["darwin", "x64", "darwin-amd64"],
    ["darwin", "arm64", "darwin-arm64"],
  ] as const)("selects %s/%s artifacts", (platform, arch, suffix) => {
    expect(releaseAsset("overtchat", platform, arch)).toBe(
      `overtchat-${suffix}`,
    );
    expect(releaseAsset("overtchat-connector", platform, arch)).toBe(
      `overtchat-connector-${suffix}`,
    );
  });
  it("rejects unsupported operating systems and CPUs", () => {
    expect(() => releaseAsset("overtchat", "win32", "x64")).toThrow(
      "Linux and macOS",
    );
    expect(() => releaseAsset("overtchat", "darwin", "arm")).toThrow(
      "does not support arm",
    );
  });
});

it("finds Docker Desktop and Homebrew from a minimal Mac SSH environment", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  const environment = commandEnvironment({
    PATH: "/usr/bin:/bin",
    DOCKER_CONTEXT: "desktop-linux",
  });
  expect(environment.PATH).toContain(
    "/Applications/Docker.app/Contents/Resources/bin",
  );
  expect(environment.PATH).toContain("/opt/homebrew/bin");
  expect(environment.PATH).toMatch(/^\/usr\/bin:\/bin:/u);
  expect(environment.DOCKER_CONTEXT).toBe("desktop-linux");
});

it("uses CPU images on Mac even for previously saved GPU settings", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  const config = {
    tts: {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "auto",
      gpuUuid: "GPU-1",
      gpuVariant: "blackwell",
    },
    stt: {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "gpu",
      gpuUuid: "GPU-2",
    },
  } as InstallationConfig;
  const result = platformServices(config);
  expect(result.tts).toEqual({
    provider: "bundled",
    bundledInstalled: true,
    accelerator: "cpu",
  });
  expect(result.stt).toEqual({
    provider: "bundled",
    bundledInstalled: true,
    accelerator: "cpu",
  });
  expect(config.stt.accelerator).toBe("gpu");
});

it("preserves external services on Mac", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  const config = {
    tts: {
      provider: "openai-compatible",
      bundledInstalled: false,
      baseUrl: "http://speech.example:8880",
    },
    stt: { provider: "disabled", bundledInstalled: false },
  } as InstallationConfig;
  expect(platformServices(config)).toEqual(config);
});
