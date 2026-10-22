import os from "node:os";
import path from "node:path";
import type { RuntimePaths } from "./types.js";

export function runtimePaths(environment = process.env): RuntimePaths {
  const home = environment.OVERTCHAT_HOME?.trim() || os.homedir();
  const windowsRoot = process.platform === "win32"
    ? path.join(environment.OVERTCHAT_HOME?.trim() || environment.LOCALAPPDATA || path.join(home, "AppData", "Local"), "OvertChat")
    : undefined;
  const configDirectory =
    environment.OVERTCHAT_CONFIG_DIR?.trim() ||
    (windowsRoot ? path.join(windowsRoot, "config") : path.join(home, ".config", "overtchat"));
  const stackDirectory =
    environment.OVERTCHAT_STACK_DIR?.trim() ||
    (windowsRoot ? path.join(windowsRoot, "stack") : path.join(home, ".local", "share", "overtchat"));
  const searxngDirectory = path.join(stackDirectory, "searxng");
  return {
    configDirectory,
    stateFile: path.join(configDirectory, "installation.json"),
    secretsFile: path.join(configDirectory, "stack.env"),
    stackDirectory,
    composeFile: path.join(stackDirectory, "compose.yml"),
    searxngDirectory,
    searxngSettingsFile: path.join(searxngDirectory, "settings.yml"),
    cloudDirectory: path.join(stackDirectory, "cloud"),
  };
}

export function executableName(component: "overtchat" | "overtchat-connector"): string {
  if (process.platform !== "win32") return component;
  // The Windows connector command launches its packaged Node runtime.
  return `${component}${component === "overtchat" ? ".exe" : ".cmd"}`;
}

export function installationBinDirectory(): string {
  if (process.env.OVERTCHAT_BIN_DIR?.trim()) return process.env.OVERTCHAT_BIN_DIR.trim();
  return process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "OvertChat", "bin")
    : path.join(os.homedir(), ".local", "bin");
}
