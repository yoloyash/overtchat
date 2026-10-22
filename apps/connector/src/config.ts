import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeHostConnectorServerUrl } from "@overtchat/agent-bridge";
import { protectWindowsDirectory } from "./windows-security.js";

export type ConnectorConfig = {
  serverUrl: string;
  connectorId: string;
  token: string;
};

export function connectorConfigPath(): string {
  return (
    process.env.OVERTCHAT_CONNECTOR_CONFIG ??
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "OvertChat", "config", "connector.json")
      : path.join(os.homedir(), ".config", "overtchat", "connector.json"))
  );
}

export function connectorStatePath(connectorId: string): string {
  return (
    process.env.OVERTCHAT_CONNECTOR_STATE ??
    path.join(
      path.dirname(connectorConfigPath()),
      `connector-${connectorId}.state.json`,
    )
  );
}

export function connectorTimelinePath(connectorId: string): string {
  return (
    process.env.OVERTCHAT_CONNECTOR_TIMELINES ??
    path.join(
      path.dirname(connectorConfigPath()),
      `connector-${connectorId}.timelines`,
    )
  );
}

export function connectorLockPath(connectorId: string): string {
  return (
    process.env.OVERTCHAT_CONNECTOR_LOCK ??
    path.join(
      path.dirname(connectorConfigPath()),
      `connector-${connectorId}.lock`,
    )
  );
}

export async function readConnectorConfig(): Promise<ConnectorConfig> {
  const file = connectorConfigPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(
      "OvertChat Connector is not configured. Run overtchat setup.",
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof Reflect.get(parsed, "serverUrl") !== "string" ||
    typeof Reflect.get(parsed, "connectorId") !== "string" ||
    typeof Reflect.get(parsed, "token") !== "string"
  ) {
    throw new Error(`Invalid connector configuration at ${file}.`);
  }
  return parsed as ConnectorConfig;
}

export async function writeConnectorConfig(
  config: ConnectorConfig,
): Promise<void> {
  const file = connectorConfigPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await protectWindowsDirectory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    await renameWithRetry(temporary, file);
    if (process.platform !== "win32") {
      const directory = await open(path.dirname(file), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}

// Antivirus scanners and the search indexer briefly hold newly written files
// open on Windows, which makes replacing them fail with a sharing violation.
export async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await rename(source, destination); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !["EBUSY", "EPERM", "EACCES"].includes(code) || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export function normalizeServerUrl(value: string): string {
  return normalizeHostConnectorServerUrl(value);
}
