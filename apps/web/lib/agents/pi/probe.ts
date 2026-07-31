import "server-only";
import path from "node:path";
import type {
  AgentConnectionDraft,
  AgentConnectionProbe,
  AgentReadyConnectionProbe,
} from "@/lib/agents/types";
import {
  type HostTarget,
  executeOnHost,
} from "@/lib/agents/runtime/process";
import { scanSshHostKey } from "@/lib/agents/runtime/ssh";
import { startPiRpc } from "@/lib/agents/pi/client";

const MODEL_PROBE_TIMEOUT_MS = 120_000;
const DIRECTORY_PROBE = `
const fs = require("node:fs");
const path = require("node:path");
const input = process.argv[1];
const resolved = fs.realpathSync(input);
const stat = fs.statSync(resolved);
if (!stat.isDirectory()) throw new Error("Path is not a directory.");
fs.readdirSync(resolved);
process.stdout.write(JSON.stringify({ path: resolved, name: path.basename(resolved) || resolved }));
`.trim();
const DIRECTORY_LIST = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const requested = process.argv[1] || os.homedir();
const resolved = fs.realpathSync(requested);
if (!fs.statSync(resolved).isDirectory()) throw new Error("Path is not a directory.");
const directories = fs.readdirSync(resolved, { withFileTypes: true })
  .flatMap((entry) => {
    const full = path.join(resolved, entry.name);
    try {
      return entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory())
        ? [{ name: entry.name, path: full }]
        : [];
    } catch {
      return [];
    }
  })
  .sort((left, right) => left.name.localeCompare(right.name));
const root = path.parse(resolved).root;
process.stdout.write(JSON.stringify({
  path: resolved,
  parent: resolved === root ? null : path.dirname(resolved),
  directories,
}));
`.trim();

export type ProbedWorkspace = {
  path: string;
  name: string;
};

export type ProbedDirectoryListing = {
  path: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
};

export async function targetForConnectionDraft(
  draft: AgentConnectionDraft,
): Promise<HostTarget> {
  if (draft.transport === "local") {
    return { transport: "local" };
  }
  if (!draft.hostKey?.trim()) {
    throw new Error("Confirm the SSH host key before connecting.");
  }
  if (draft.sshAuth === "private_key" && !draft.privateKey?.trim()) {
    throw new Error("An SSH private key is required.");
  }
  return {
    transport: "ssh",
    hostname: draft.hostname,
    port: draft.port,
    username: draft.username,
    hostKey: draft.hostKey.trim(),
    ...(draft.privateKey?.trim()
      ? { privateKey: draft.privateKey.trim() }
      : {}),
  };
}

export async function probePiConnection(
  draft: AgentConnectionDraft,
): Promise<AgentConnectionProbe> {
  if (draft.transport === "ssh" && !draft.hostKey?.trim()) {
    const scanned = await scanSshHostKey(draft.hostname, draft.port);
    return {
      status: "host_key",
      hostKey: scanned.hostKey,
      hostKeyFingerprint: scanned.fingerprint,
    };
  }
  return probePiTarget(
    await targetForConnectionDraft(draft),
    draft.executable,
  );
}

export async function probePiTarget(
  target: HostTarget,
  executable: string,
): Promise<AgentReadyConnectionProbe> {
  const versionResult = await executeOnHost(target, {
    command: executable,
    args: ["--version"],
  });
  const version = versionResult.stdout.trim().split(/\s+/u).at(-1);
  if (!version) throw new Error("Pi returned an empty version.");

  const client = startPiRpc(target, {
    executable,
    noSession: true,
    extraArgs: [
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
    ],
  });
  try {
    await client.getState();
    const models = await client.getAvailableModels(MODEL_PROBE_TIMEOUT_MS);
    if (models.length === 0) {
      throw new Error(
        "Pi is installed, but it did not report any usable models.",
      );
    }
    return {
      status: "ready",
      version,
      models,
    };
  } finally {
    await client.stop();
  }
}

export async function probeAgentWorkspace(
  target: HostTarget,
  workspacePath: string,
): Promise<ProbedWorkspace> {
  const result = await executeOnHost(target, {
    command: "node",
    args: ["-e", DIRECTORY_PROBE, workspacePath],
  });
  const parsed = JSON.parse(result.stdout) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof Reflect.get(parsed, "path") !== "string" ||
    typeof Reflect.get(parsed, "name") !== "string"
  ) {
    throw new Error("The remote machine returned invalid directory metadata.");
  }
  return {
    path: Reflect.get(parsed, "path") as string,
    name:
      (Reflect.get(parsed, "name") as string) ||
      path.posix.basename(Reflect.get(parsed, "path") as string),
  };
}

export async function listAgentDirectories(
  target: HostTarget,
  directoryPath?: string,
): Promise<ProbedDirectoryListing> {
  const result = await executeOnHost(target, {
    command: "node",
    args: ["-e", DIRECTORY_LIST, directoryPath ?? ""],
  });
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The remote machine returned an invalid directory list.");
  }
  const pathValue = Reflect.get(parsed, "path");
  const parent = Reflect.get(parsed, "parent");
  const directories = Reflect.get(parsed, "directories");
  if (
    typeof pathValue !== "string" ||
    (parent !== null && typeof parent !== "string") ||
    !Array.isArray(directories) ||
    !directories.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof Reflect.get(entry, "name") === "string" &&
        typeof Reflect.get(entry, "path") === "string",
    )
  ) {
    throw new Error("The remote machine returned an invalid directory list.");
  }
  return {
    path: pathValue,
    parent,
    directories: directories.map((entry) => ({
      name: Reflect.get(entry, "name") as string,
      path: Reflect.get(entry, "path") as string,
    })),
  };
}
