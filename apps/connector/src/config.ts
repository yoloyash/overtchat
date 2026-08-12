import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeHostConnectorServerUrl } from "@overtchat/agent-bridge";

export type ConnectorConfig = {
  serverUrl: string;
  connectorId: string;
  token: string;
};

export function connectorConfigPath(): string {
  return (
    process.env.OVERTCHAT_CONNECTOR_CONFIG ??
    path.join(os.homedir(), ".config", "overtchat", "connector.json")
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
      `OvertChat Connector is not paired. Run overtchat-connector install --server <url> --pair-code <code>.`,
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
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(file, 0o600);
}

export function normalizeServerUrl(value: string): string {
  return normalizeHostConnectorServerUrl(value);
}
