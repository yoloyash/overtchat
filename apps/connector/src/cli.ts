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

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > 16 * 1024) {
      throw new Error("Managed connector configuration is too large.");
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Managed connector configuration must be valid JSON.");
  }
}

function managedConfig(value: unknown): {
  serverUrl: string;
  connectorId: string;
  token: string;
} {
  if (!value || typeof value !== "object") {
    throw new Error("Managed connector configuration is invalid.");
  }
  const server = Reflect.get(value, "serverUrl");
  const connectorId = Reflect.get(value, "connectorId");
  const token = Reflect.get(value, "token");
  if (
    typeof server !== "string" ||
    typeof connectorId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(connectorId) ||
    typeof token !== "string" ||
    !token.startsWith(`oct_${connectorId}.`)
  ) {
    throw new Error("Managed connector configuration is invalid.");
  }
  return {
    serverUrl: normalizeServerUrl(server),
    connectorId,
    token,
  };
}

async function installManaged(): Promise<void> {
  await assertUserServiceAvailable();
  const config = managedConfig(await readStdinJson());
  await writeConnectorConfig(config);
  const unitPath = await installUserService();
  console.log(`Managed service installed at ${unitPath}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const command =
    argv[0] === "--version" || argv[0] === "-v"
      ? "version"
      : argv[0] && !argv[0].startsWith("-")
        ? argv[0]
        : "run";
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
    case "install-managed":
      if (parsed.values.size > 0) {
        throw new Error("The install-managed command reads configuration from stdin.");
      }
      await installManaged();
      return;
    case "run":
      if (parsed.values.size > 0) {
        throw new Error(
          "The run command does not accept options; it uses the provisioned connector configuration.",
        );
      }
      await run();
      return;
    case "preflight":
      if (parsed.values.size > 0) {
        throw new Error("The preflight command does not accept arguments.");
      }
      await preflight();
      return;
    case "version":
      if (parsed.values.size > 0) {
        throw new Error("The version command does not accept arguments.");
      }
      console.log(CONNECTOR_VERSION);
      return;
    default:
      throw new Error(
        "Usage: overtchat-connector <install|install-managed|pair|preflight|run|version>",
      );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
