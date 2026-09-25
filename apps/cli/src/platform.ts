import os from "node:os";
import path from "node:path";
import type { InstallationConfig } from "./types.js";

export function releaseAsset(
  component: "overtchat" | "overtchat-connector",
  platform = process.platform,
  architecture = process.arch,
): string {
  if (platform !== "linux" && platform !== "darwin") {
    throw new Error("Managed OvertChat supports Linux and macOS.");
  }
  const arch = architecture === "x64" ? "amd64" : architecture;
  if (arch !== "amd64" && arch !== "arm64") {
    throw new Error(`OvertChat does not support ${architecture}.`);
  }
  return `${component}-${platform}-${arch}`;
}

export function commandEnvironment(
  environment = process.env,
): NodeJS.ProcessEnv {
  if (process.platform !== "darwin") return environment;
  return {
    ...environment,
    PATH: [
      environment.PATH,
      path.join(os.homedir(), ".docker", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/Applications/Docker.app/Contents/Resources/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]
      .filter(Boolean)
      .join(":"),
  };
}

// CUDA is Linux-only. Preserve an explicit Apple selection; legacy CPU installs
// stay on CPU until setup selects Apple acceleration.
export function platformServices(
  config: InstallationConfig,
): InstallationConfig {
  if (process.platform !== "darwin") return config;
  return {
    ...config,
    tts: config.tts.bundledInstalled
      ? {
          ...config.tts,
          accelerator: config.tts.accelerator === "apple" ? "apple" : "cpu",
          gpuUuid: undefined,
          gpuVariant: undefined,
        }
      : config.tts,
    stt: config.stt.bundledInstalled
      ? { ...config.stt, accelerator: config.stt.accelerator === "apple" ? "apple" : "cpu", gpuUuid: undefined }
      : config.stt,
  };
}
