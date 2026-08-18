import { z } from "zod";
import {
  agentSessionLaunchConfigSchema,
  type AgentProviderSessionMetadata,
} from "@overtchat/agent-bridge";
import { executeOnHost, type HostTarget } from "@overtchat/agent-runtime/runtime/process";

const SESSION_SCAN_TIMEOUT_MS = 60_000;
const metadataSchema = z.array(z.object({
  providerSessionId: z.string().min(1),
  providerSessionPath: z.string().min(1),
  name: z.string().nullable(),
  firstMessage: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.number().finite().nullable(),
  modifiedAt: z.number().finite().nullable(),
  launchConfig: agentSessionLaunchConfigSchema.optional(),
}));

// OMP owns this import contract. The script is self-contained because it may
// execute through SSH on a host that has no OvertChat package files.
const OMP_SESSION_SCAN_SCRIPT = String.raw`
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
  } catch { return null; }
};
const rawProfile = (process.env.OMP_PROFILE || process.env.PI_PROFILE || "").trim();
const profile = rawProfile && rawProfile !== "default" ? rawProfile : "default";
const baseConfigRoot = expand(process.env.PI_CONFIG_DIR || "~/.omp", process.cwd());
const configRoot = profile === "default" ? baseConfigRoot : path.join(baseConfigRoot, "profiles", profile);
const agentDir = expand(process.env.OMP_AGENT_DIR || (profile === "default" ? process.env.PI_CODING_AGENT_DIR : "") || path.join(configRoot, "agent"), process.cwd());
const configured = process.env.OMP_SESSION_DIR || process.env.PI_CODING_AGENT_SESSION_DIR || readSettingsDir(path.join(requestedCwd, ".omp", "settings.json")) || readSettingsDir(path.join(agentDir, "settings.json"));
const root = expand(configured || path.join(agentDir, "sessions"), requestedCwd);
const projectDir = path.join(root, "--" + requestedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--");
async function walk(directory) {
  let entries;
  try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  return (await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [full] : [];
  }))).flat();
}
function textContent(message) {
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim();
}
async function readSession(file) {
  let header = null, name = null, firstMessage = null, messageCount = 0, modifiedAt = null, model = null, thinkingOptionId = null;
  try {
    const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type === "title") { name = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : name; continue; }
      if (!header) {
        if (entry.type !== "session" || typeof entry.id !== "string" || typeof entry.cwd !== "string") continue;
        let entryCwd;
        try { entryCwd = fs.realpathSync(entry.cwd); } catch { entryCwd = path.resolve(entry.cwd); }
        if (entryCwd !== requestedCwd) return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : null;
      if (entry.type === "model_change") {
        if (typeof entry.provider === "string" && typeof entry.modelId === "string") model = entry.provider + "/" + entry.modelId;
        else if (typeof entry.model === "string" && entry.model.trim()) model = entry.model.trim();
      }
      if (entry.type === "thinking_level_change" && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(entry.thinkingLevel)) thinkingOptionId = entry.thinkingLevel;
      if (entry.type !== "message" || !entry.message) continue;
      messageCount++;
      const activity = typeof entry.message.timestamp === "number" ? entry.message.timestamp : Date.parse(entry.timestamp);
      if (Number.isFinite(activity)) modifiedAt = Math.max(modifiedAt || 0, activity);
      if (!firstMessage && entry.message.role === "user") firstMessage = textContent(entry.message) || null;
      if (entry.message.role === "assistant" && typeof entry.message.provider === "string" && typeof entry.message.model === "string") model = entry.message.provider + "/" + entry.message.model;
    }
    if (!header) return null;
    const createdAt = Date.parse(header.timestamp);
    if (!modifiedAt) modifiedAt = (await fsp.stat(file)).mtimeMs;
    return { providerSessionId: header.id, providerSessionPath: file, name, firstMessage, messageCount, createdAt: Number.isFinite(createdAt) ? createdAt : null, modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null, launchConfig: { ...(model ? { model } : {}), ...(thinkingOptionId ? { thinkingOptionId } : {}), modeId: "full" } };
  } catch { return null; }
}
(async () => {
  let files = await walk(projectDir);
  if (!files.length) files = await walk(root);
  const ranked = await Promise.all(files.map(async (file) => { try { return { file, mtime: (await fsp.stat(file)).mtimeMs }; } catch { return null; } }));
  ranked.sort((a, b) => (b?.mtime || 0) - (a?.mtime || 0));
  const sessions = [];
  for (const item of ranked) {
    if (!item || sessions.length >= 200) continue;
    const session = await readSession(item.file);
    if (session) sessions.push(session);
  }
  process.stdout.write(JSON.stringify(sessions));
})().catch((error) => { process.stderr.write(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
`.trim();

export async function listOmpWorkspaceSessions(
  target: HostTarget,
  workspacePath: string,
): Promise<AgentProviderSessionMetadata[]> {
  const result = await executeOnHost(
    target,
    { command: "node", args: ["-e", OMP_SESSION_SCAN_SCRIPT, workspacePath] },
    { timeoutMs: SESSION_SCAN_TIMEOUT_MS },
  );
  return metadataSchema.parse(JSON.parse(result.stdout)).map((session) => ({
    ...session,
    createdAt: session.createdAt === null ? null : new Date(session.createdAt),
    modifiedAt: session.modifiedAt === null ? null : new Date(session.modifiedAt),
  }));
}
