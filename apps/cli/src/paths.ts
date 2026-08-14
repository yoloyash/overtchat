import os from "node:os";
import path from "node:path";
import type { RuntimePaths } from "./types.js";

export function runtimePaths(environment = process.env): RuntimePaths {
  const home = environment.OVERTCHAT_HOME?.trim() || os.homedir();
  const configDirectory =
    environment.OVERTCHAT_CONFIG_DIR?.trim() ||
    path.join(home, ".config", "overtchat");
  const stackDirectory =
    environment.OVERTCHAT_STACK_DIR?.trim() ||
    path.join(home, ".local", "share", "overtchat");
  const searxngDirectory = path.join(stackDirectory, "searxng");
  return {
    configDirectory,
    stateFile: path.join(configDirectory, "installation.json"),
    secretsFile: path.join(configDirectory, "stack.env"),
    stackDirectory,
    composeFile: path.join(stackDirectory, "compose.yml"),
    searxngDirectory,
    searxngSettingsFile: path.join(searxngDirectory, "settings.yml"),
  };
}
