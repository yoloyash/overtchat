import "server-only";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSshHostCandidate } from "@/lib/agents/types";
import { executeOnHost } from "@/lib/agents/runtime/process";

const MAX_ALIASES = 32;
const SAFE_ALIAS = /^[a-zA-Z0-9._-]+$/u;
const SAFE_HOSTNAME = /^[a-zA-Z0-9._:-]+$/u;
const SAFE_USERNAME = /^[a-zA-Z0-9._-]+$/u;

export function parseExplicitSshAliases(config: string): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of config.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^host(?:\s+|=)(.+)$/iu.exec(line);
    if (!match) continue;
    for (const rawAlias of match[1].trim().split(/\s+/u)) {
      const alias = rawAlias.replace(/^(['"])(.*)\1$/u, "$2");
      if (
        seen.has(alias) ||
        !SAFE_ALIAS.test(alias) ||
        /[*?!]/u.test(alias)
      ) {
        continue;
      }
      seen.add(alias);
      aliases.push(alias);
      if (aliases.length >= MAX_ALIASES) return aliases;
    }
  }
  return aliases;
}

export function parseSshConfigExpansion(
  alias: string,
  output: string,
): AgentSshHostCandidate | null {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(\S+)\s+(.+)$/u.exec(line.trim());
    const key = match?.[1].toLowerCase();
    if (match && key && !values.has(key)) {
      values.set(key, match[2].trim());
    }
  }

  const hostname = values.get("hostname");
  const username = values.get("user");
  const port = Number(values.get("port"));
  const proxyCommand = values.get("proxycommand");
  const proxyJump = values.get("proxyjump");
  const hostKeyAlias = values.get("hostkeyalias");
  if (
    !hostname ||
    !username ||
    !SAFE_HOSTNAME.test(hostname) ||
    !SAFE_USERNAME.test(username) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    (proxyCommand && proxyCommand !== "none") ||
    (proxyJump && proxyJump !== "none") ||
    (hostKeyAlias && hostKeyAlias !== "none")
  ) {
    return null;
  }
  return { alias, hostname, port, username };
}

async function configuredAliases(): Promise<string[]> {
  try {
    const config = await readFile(
      path.join(os.homedir(), ".ssh", "config"),
      "utf8",
    );
    return parseExplicitSshAliases(config);
  } catch {
    return [];
  }
}

async function expandAlias(
  alias: string,
): Promise<AgentSshHostCandidate | null> {
  try {
    const result = await executeOnHost(
      { transport: "local" },
      { command: "ssh", args: ["-G", alias] },
      { timeoutMs: 5_000 },
    );
    return parseSshConfigExpansion(alias, result.stdout);
  } catch {
    return null;
  }
}

export async function listConfiguredSshHosts(): Promise<
  AgentSshHostCandidate[]
> {
  const aliases = await configuredAliases();
  const expanded = await Promise.all(aliases.map(expandAlias));
  return expanded.filter(
    (candidate): candidate is AgentSshHostCandidate => candidate !== null,
  );
}

export async function resolveConfiguredSshHost(
  alias: string,
): Promise<AgentSshHostCandidate | null> {
  if (!SAFE_ALIAS.test(alias)) return null;
  const aliases = await configuredAliases();
  return aliases.includes(alias) ? expandAlias(alias) : null;
}
