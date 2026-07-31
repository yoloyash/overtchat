import "server-only";
import { z } from "zod";
import type { ProviderSessionMetadata } from "@/lib/db/agentConnections";
import {
  executeOnHost,
  type HostTarget,
} from "@/lib/agents/runtime/process";

const SESSION_SCAN_TIMEOUT_MS = 60_000;

const sessionMetadataSchema = z.array(
  z.object({
    providerSessionId: z.string().min(1),
    providerSessionPath: z.string().min(1),
    name: z.string().nullable(),
    firstMessage: z.string().nullable(),
    messageCount: z.number().int().nonnegative(),
    createdAt: z.number().finite().nullable(),
    modifiedAt: z.number().finite().nullable(),
  }),
);

// Kept self-contained because the same script is sent over SSH. Pi exposes
// session resume over RPC, but not recent-session discovery.
const SESSION_SCAN_SCRIPT = String.raw`
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const requestedCwd = fs.realpathSync(process.argv[1]);
const home = os.homedir();
const expand = (value, base) => {
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(base, value);
};
const readSettingsDir = (file) => {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")).sessionDir;
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
};
const agentDir = expand(process.env.PI_CODING_AGENT_DIR || "~/.pi/agent", process.cwd());
const configured =
  process.env.PI_CODING_AGENT_SESSION_DIR ||
  readSettingsDir(path.join(requestedCwd, ".pi", "settings.json")) ||
  readSettingsDir(path.join(agentDir, "settings.json"));
const root = configured
  ? expand(configured, requestedCwd)
  : path.join(agentDir, "sessions");
const defaultProjectDir = path.join(
  root,
  "--" + requestedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--",
);

async function walk(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [full] : [];
  }));
  return nested.flat();
}

function textContent(message) {
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function readSession(file) {
  let header = null;
  let name = null;
  let firstMessage = null;
  let messageCount = 0;
  let modifiedAt = null;
  try {
    const input = fs.createReadStream(file, { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!header) {
        if (entry.type !== "session" || typeof entry.id !== "string" || typeof entry.cwd !== "string") {
          return null;
        }
        let entryCwd;
        try { entryCwd = fs.realpathSync(entry.cwd); } catch { entryCwd = path.resolve(entry.cwd); }
        if (entryCwd !== requestedCwd) return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : null;
      }
      if (entry.type !== "message" || !entry.message) continue;
      messageCount++;
      const activity =
        typeof entry.message.timestamp === "number"
          ? entry.message.timestamp
          : Date.parse(entry.timestamp);
      if (Number.isFinite(activity)) modifiedAt = Math.max(modifiedAt || 0, activity);
      if (!firstMessage && entry.message.role === "user") {
        firstMessage = textContent(entry.message) || null;
      }
    }
    if (!header) return null;
    const createdAt = Date.parse(header.timestamp);
    if (!modifiedAt) {
      const stat = await fsp.stat(file);
      modifiedAt = stat.mtimeMs;
    }
    return {
      providerSessionId: header.id,
      providerSessionPath: file,
      name,
      firstMessage,
      messageCount,
      createdAt: Number.isFinite(createdAt) ? createdAt : null,
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null,
    };
  } catch {
    return null;
  }
}

(async () => {
  let files = await walk(configured ? root : defaultProjectDir);
  if (!configured && files.length === 0) files = await walk(root);
  const ranked = await Promise.all(files.map(async (file) => {
    try { return { file, mtime: (await fsp.stat(file)).mtimeMs }; }
    catch { return null; }
  }));
  ranked.sort((a, b) => (b?.mtime || 0) - (a?.mtime || 0));
  const sessions = [];
  for (const item of ranked) {
    if (!item || sessions.length >= 200) continue;
    const session = await readSession(item.file);
    if (session) sessions.push(session);
  }
  process.stdout.write(JSON.stringify(sessions));
})().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`.trim();

export async function listPiWorkspaceSessions(
  target: HostTarget,
  workspacePath: string,
): Promise<ProviderSessionMetadata[]> {
  const result = await executeOnHost(
    target,
    {
      command: "node",
      args: ["-e", SESSION_SCAN_SCRIPT, workspacePath],
    },
    { timeoutMs: SESSION_SCAN_TIMEOUT_MS },
  );
  const parsed = sessionMetadataSchema.parse(JSON.parse(result.stdout));
  return parsed.map((session) => ({
    ...session,
    createdAt:
      session.createdAt === null ? null : new Date(session.createdAt),
    modifiedAt:
      session.modifiedAt === null ? null : new Date(session.modifiedAt),
  }));
}
