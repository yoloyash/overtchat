import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:4718";

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

export async function readConnectorConfig(): Promise<ConnectorConfig> {
  const file = connectorConfigPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(
      `OvertChat Connector is not paired. Run overtchat-connector install --pair-code <code>.`,
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
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("OvertChat URL must use HTTP or HTTPS.");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}
