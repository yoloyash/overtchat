#!/usr/bin/env node
import os from "node:os";
import {
  normalizeServerUrl,
  readConnectorConfig,
  writeConnectorConfig,
} from "./config.js";
import { ConnectorClient } from "./client.js";
import {
  assertUserServiceAvailable,
  installUserService,
} from "./service.js";
import { CONNECTOR_VERSION } from "./version.js";

type ParsedArgs = {
  command: string;
  values: Map<string, string>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "run";
  const rest = command === "run" && argv[0]?.startsWith("-") ? argv : argv.slice(1);
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = rest[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}.`);
    }
    values.set(key.slice(2), value);
  }
  return { command, values };
}

async function pair(values: Map<string, string>): Promise<void> {
  const pairCode = values.get("pair-code");
  if (!pairCode) throw new Error("--pair-code is required.");
  const server = values.get("server");
  if (!server) throw new Error("--server is required.");
  const serverUrl = normalizeServerUrl(server);
  const response = await fetch(`${serverUrl}/api/host-connectors/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairCode,
      name: values.get("name") ?? os.hostname(),
      version: CONNECTOR_VERSION,
    }),
  });
  const data = (await response.json().catch(() => null)) as
    | { connectorId: string; token: string; error?: never }
    | { error: string }
    | null;
  if (!response.ok || !data || "error" in data) {
    throw new Error(data?.error ?? `OvertChat returned HTTP ${response.status}.`);
  }
  await writeConnectorConfig({
    serverUrl,
    connectorId: data.connectorId,
    token: data.token,
  });
  console.log(`Paired with ${serverUrl}`);
}

async function run(): Promise<void> {
  const config = await readConnectorConfig();
  const client = await ConnectorClient.create(config);
  const stop = () => {
    void client.stop().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`Connecting to ${config.serverUrl}`);
  try {
    await client.run();
  } finally {
    await client.stop();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function preflight(): Promise<void> {
  const config = await readConnectorConfig();
  const client = await ConnectorClient.create(config);
  await client.stop();
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.command) {
    case "pair":
      await pair(parsed.values);
      return;
    case "install": {
      await assertUserServiceAvailable();
      await pair(parsed.values);
      const unitPath = await installUserService();
      console.log(`Service installed at ${unitPath}`);
      return;
    }
    case "run":
      await run();
      return;
    case "preflight":
      if (parsed.values.size > 0) {
        throw new Error("The preflight command does not accept arguments.");
      }
      await preflight();
      return;
    default:
      throw new Error(
        "Usage: overtchat-connector <install|pair|run> --server URL --pair-code CODE",
      );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
