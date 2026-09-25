import os from "node:os";
import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import {
  appleSpeechCapabilities,
  speechLocations,
  stopSpeechAgent,
} from "./apple-speech.js";
import { optionalFile } from "./management.js";
import { requireSuccessful, runCommand } from "./process.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

export type NativeService = {
  id: "connector" | "speech";
  label: string;
  file: string;
  logs: string[];
  binary?: string;
  configFile?: string;
  dataFiles?: string[];
};
export async function nativeServices(
  config: InstallationConfig,
  paths: RuntimePaths,
): Promise<NativeService[]> {
  const result: NativeService[] = [];
  if (config.agents.installed) {
    const home = os.homedir();
    const configFile = path.join(
      home,
      ".config",
      "overtchat",
      "connector.json",
    );
    const contents = await optionalFile(configFile);
    if (!contents)
      throw new Error(
        `Connector configuration is missing at ${configFile}. Run overtchat setup to repair it.`,
      );
    const saved = JSON.parse(contents) as {
      serverUrl?: string;
      connectorId?: string;
    };
    if (saved.serverUrl !== `http://127.0.0.1:${config.appPort}`)
      throw new Error(
        "The Host Connector belongs to another server. Refusing to manage its service.",
      );
    if (
      config.agents.connectorId &&
      saved.connectorId !== config.agents.connectorId
    )
      throw new Error(
        "The Host Connector identity has changed. Refusing to manage another connector.",
      );
    const binary = path.join(home, ".local", "bin", "overtchat-connector");
    const file =
      process.platform === "darwin"
        ? path.join(
            home,
            "Library",
            "LaunchAgents",
            "com.overtchat.connector.plist",
          )
        : path.join(
            home,
            ".config",
            "systemd",
            "user",
            "overtchat-connector.service",
          );
    const unit = await optionalFile(file);
    if (unit && !unit.includes(binary))
      throw new Error(
        `The connector service at ${file} uses an unmanaged executable.`,
      );
    const dataFiles =
      saved.connectorId && /^[a-zA-Z0-9-]+$/u.test(saved.connectorId)
        ? (await readdir(path.dirname(configFile)))
            .filter((name) =>
              name.startsWith(`connector-${saved.connectorId}.`),
            )
            .map((name) => path.join(path.dirname(configFile), name))
        : [];
    result.push({
      id: "connector",
      label:
        process.platform === "darwin"
          ? "com.overtchat.connector"
          : "overtchat-connector.service",
      file,
      binary,
      configFile,
      dataFiles,
      logs:
        process.platform === "darwin"
          ? [
              path.join(home, "Library", "Logs", "OvertChat", "connector.log"),
              path.join(
                home,
                "Library",
                "Logs",
                "OvertChat",
                "connector.error.log",
              ),
            ]
          : [],
    });
  }
  const speech = speechLocations(paths);
  if (
    process.platform === "darwin" &&
    (appleSpeechCapabilities(config).length ||
      (await optionalFile(speech.plist)))
  ) {
    result.push({
      id: "speech",
      label: speech.label,
      file: speech.plist,
      logs: [path.join(speech.root, "speech.log")],
    });
  }
  return result;
}

export async function manageNative(
  service: NativeService,
  action: "start" | "stop" | "remove",
): Promise<void> {
  const file = await optionalFile(service.file);
  if (!file) {
    if (action === "start")
      throw new Error(
        `${service.id} service is missing. Run overtchat setup to repair it.`,
      );
    return;
  }
  if (process.platform === "darwin") {
    const domain = `gui/${process.getuid!()}`;
    const target = `${domain}/${service.label}`;
    if (action === "start") {
      const registered = await runCommand("launchctl", ["print", target]);
      await requireSuccessful("launchctl", ["enable", target]);
      if (registered.exitCode !== 0)
        await requireSuccessful("launchctl", [
          "bootstrap",
          domain,
          service.file,
        ]);
      await requireSuccessful("launchctl", ["kickstart", target]);
    } else await stopSpeechAgent(target);
  } else {
    await requireSuccessful("systemctl", [
      "--user",
      ...(action === "remove" ? ["disable", "--now"] : [action]),
      service.label,
    ]);
  }
  if (action === "remove") {
    await rm(service.file, { force: true });
    if (process.platform !== "darwin")
      await requireSuccessful("systemctl", ["--user", "daemon-reload"]);
  }
}

export async function nativePreflight(
  config: InstallationConfig,
): Promise<void> {
  if (!config.agents.installed && !appleSpeechCapabilities(config).length)
    return;
  if (
    process.getuid?.() === 0 &&
    (process.env.SUDO_USER || process.platform === "darwin")
  )
    throw new Error("Run setup as your normal user, without sudo.");
  const check =
    process.platform === "darwin"
      ? await runCommand("launchctl", ["print", `gui/${process.getuid!()}`])
      : await runCommand("systemctl", ["--user", "show-environment"]);
  if (check.exitCode)
    throw new Error(
      process.platform === "darwin"
        ? "Native services require a logged-in macOS desktop session."
        : "Agent Connections require a running systemd user session.",
    );
}
