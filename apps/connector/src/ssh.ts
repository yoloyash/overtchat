import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ConnectorProcessLaunch,
  ConnectorSshHost,
} from "@overtchat/agent-bridge";

const execFileAsync = promisify(execFile);
const MAX_ALIASES = 128;
const MAX_CONFIG_FILES = 128;
const SAFE_ALIAS = /^(?!-)[a-zA-Z0-9._-]{1,253}$/u;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildSshRemoteCommand(
  launch: ConnectorProcessLaunch,
): string {
  const env = Object.entries(launch.env ?? {})
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const command = [launch.command, ...(launch.args ?? [])]
    .map(shellQuote)
    .join(" ");
  const invocation = `${env ? `${env} ` : ""}exec ${command}`;
  const agentCommand = launch.cwd
    ? `cd -- ${shellQuote(launch.cwd)} && ${invocation}`
    : invocation;
  const loginCommand = `exec 1>&3 3>&-; ${agentCommand}`;
  return `exec "\${SHELL:-/bin/sh}" -lc ${shellQuote(loginCommand)} 3>&1 1>&2`;
}

export function sshSpawnArgs(
  alias: string,
  launch: ConnectorProcessLaunch,
): string[] {
  if (!SAFE_ALIAS.test(alias)) throw new Error("Invalid SSH host alias.");
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    alias,
    buildSshRemoteCommand(launch),
  ];
}

function stripComment(line: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if ((character === "'" || character === '"') && line[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
    }
    if (character === "#" && quote === null) return line.slice(0, index);
  }
  return line;
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/u, "$2");
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function globExpression(value: string): RegExp {
  const escaped = value.replace(/[.+^${}()|\\]/gu, "\\$&");
  return new RegExp(
    `^${escaped.replaceAll("*", ".*").replaceAll("?", ".")}$`,
    "u",
  );
}

async function expandInclude(
  rawPattern: string,
  relativeTo: string,
): Promise<string[]> {
  const expanded = expandHome(unquote(rawPattern));
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(relativeTo, expanded);
  if (!/[*?]/u.test(absolute)) return [absolute];
  const directory = path.dirname(absolute);
  if (/[*?]/u.test(directory)) return [];
  const expression = globExpression(path.basename(absolute));
  try {
    return (await readdir(directory))
      .filter((entry) => expression.test(entry))
      .sort()
      .map((entry) => path.join(directory, entry));
  } catch {
    return [];
  }
}

async function collectAliases(
  configPath: string,
  state: { files: Set<string>; aliases: Set<string> },
): Promise<void> {
  if (
    state.files.has(configPath) ||
    state.files.size >= MAX_CONFIG_FILES ||
    state.aliases.size >= MAX_ALIASES
  ) {
    return;
  }
  state.files.add(configPath);
  let config: string;
  try {
    config = await readFile(configPath, "utf8");
  } catch {
    return;
  }
  for (const rawLine of config.split(/\r?\n/u)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const include = /^include(?:\s+|=)(.+)$/iu.exec(line);
    if (include) {
      for (const pattern of include[1].trim().split(/\s+/u)) {
        for (const included of await expandInclude(
          pattern,
          path.dirname(configPath),
        )) {
          await collectAliases(included, state);
        }
      }
      continue;
    }
    const host = /^host(?:\s+|=)(.+)$/iu.exec(line);
    if (!host) continue;
    for (const rawAlias of host[1].trim().split(/\s+/u)) {
      const alias = unquote(rawAlias);
      if (SAFE_ALIAS.test(alias) && !/[*?!]/u.test(alias)) {
        state.aliases.add(alias);
        if (state.aliases.size >= MAX_ALIASES) return;
      }
    }
  }
}

export function parseSshExpansion(
  alias: string,
  output: string,
): ConnectorSshHost | null {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(\S+)\s+(.+)$/u.exec(line.trim());
    const key = match?.[1].toLowerCase();
    if (match && key && !values.has(key)) values.set(key, match[2].trim());
  }
  const hostname = values.get("hostname");
  const username = values.get("user");
  const port = Number(values.get("port"));
  if (
    !hostname ||
    !username ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return null;
  }
  return { alias, hostname, username, port };
}

export async function listSshHosts(): Promise<ConnectorSshHost[]> {
  const state = { files: new Set<string>(), aliases: new Set<string>() };
  await collectAliases(path.join(os.homedir(), ".ssh", "config"), state);
  const hosts = await Promise.all(
    [...state.aliases].map(async (alias) => {
      try {
        const { stdout } = await execFileAsync("ssh", ["-G", alias], {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 512 * 1024,
        });
        return parseSshExpansion(alias, stdout);
      } catch {
        return null;
      }
    }),
  );
  return hosts.filter((host): host is ConnectorSshHost => host !== null);
}
