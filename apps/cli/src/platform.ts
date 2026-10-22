import os from "node:os";
import path from "node:path";
import type { InstallationConfig } from "./types.js";

export function releaseAsset(
  component: "overtchat" | "overtchat-connector",
  platform = process.platform,
  architecture = process.arch,
): string {
  if (platform !== "linux" && platform !== "darwin" && platform !== "win32") {
    throw new Error("Managed OvertChat supports Linux, macOS, and Windows.");
  }
  const arch = architecture === "x64" ? "amd64" : architecture;
  if (arch !== "amd64" && arch !== "arm64") {
    throw new Error(`OvertChat does not support ${architecture}.`);
  }
  if (platform === "win32") {
    if (arch !== "amd64") throw new Error("Managed OvertChat for Windows requires x64.");
    // The connector ships as an archive; callers add its extension.
    return `${component}-windows-amd64${component === "overtchat" ? ".exe" : ""}`;
  }
  return `${component}-${platform}-${arch}`;
}

export function commandEnvironment(
  environment = process.env,
): NodeJS.ProcessEnv {
  if (process.platform === "win32") {
    // Windows environment names are case-insensitive. Node passes only one of
    // PATH/Path to children, so do not leave two conflicting entries behind.
    const result = { ...environment };
    const key = Object.keys(result).find((name) => name.toUpperCase() === "PATH");
    const current = key ? result[key] : undefined;
    for (const name of Object.keys(result)) if (name.toUpperCase() === "PATH") delete result[name];
    const programs = environment.ProgramFiles || "C:\\Program Files";
    result.PATH = [
      current,
      environment.LOCALAPPDATA && path.win32.join(environment.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin"),
      path.win32.join(programs, "Docker", "Docker", "resources", "bin"),
      path.win32.join(programs, "Tailscale"),
      path.win32.join(environment.SystemRoot || "C:\\Windows", "System32"),
    ].filter(Boolean).join(";");
    return result;
  }
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

// macOS containers cannot use CUDA. Preserve an explicit Apple selection; legacy CPU installs
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
