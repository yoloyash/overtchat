import { z } from "zod";
import {
  agentSessionLaunchConfigSchema,
  type AgentProviderSessionMetadata,
} from "@overtchat/agent-bridge";
import {
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime/runtime/process";

const SESSION_TIMEOUT_MS = 60_000;

const metadataSchema = z.array(
  z.object({
    providerSessionId: z.string().min(1),
    providerSessionPath: z.string().min(1),
    name: z.string().nullable(),
    firstMessage: z.string().nullable(),
    messageCount: z.number().int().nonnegative(),
    createdAt: z.number().finite().nullable(),
    modifiedAt: z.number().finite().nullable(),
    launchConfig: agentSessionLaunchConfigSchema.optional(),
  }),
);

const historySchema = z.array(z.unknown());

// Self-contained because it runs on both the connector host and SSH targets.
const CLAUDE_SESSION_SCRIPT = String.raw`
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const mode = process.argv[1];
const input = process.argv[2];
const root = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, "projects")
  : path.join(os.homedir(), ".claude", "projects");
const clip = (value, limit = 50000) =>
  typeof value === "string" && value.length > limit
    ? value.slice(0, limit) + "\n… [" + (value.length - limit) + " characters truncated]"
    : value;
const boundedInput = (value) => {
  try {
    const serialized = JSON.stringify(value ?? {});
    return serialized.length > 50000
      ? { overtchatTruncated: true, preview: serialized.slice(0, 50000) }
      : value ?? {};
  } catch {
    return { overtchatTruncated: true };
  }
};

const text = (content) => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n").trim();
};

async function files(directory) {
  let projects;
  try { projects = await fsp.readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const found = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let entries;
    try { entries = await fsp.readdir(path.join(directory, project.name), { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        found.push(path.join(directory, project.name, entry.name));
      }
    }
  }
  return found;
}

async function readEntries(file) {
  const entries = [];
  const lines = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  return entries;
}

function entryCwd(entries) {
  return entries.find((entry) => typeof entry.cwd === "string")?.cwd || null;
}

function normalized(entries) {
  const messages = [];
  for (const entry of entries) {
    if (entry.isSidechain || !entry.message || !["user", "assistant"].includes(entry.type)) continue;
    const message = entry.message;
    const timestamp = Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : Date.now();
    if (entry.type === "assistant") {
      const content = Array.isArray(message.content) ? message.content.flatMap((part) => {
        if (part?.type === "text" && typeof part.text === "string") return [{ type: "text", text: clip(part.text) }];
        if (part?.type === "thinking" && typeof part.thinking === "string") return [{ type: "thinking", thinking: clip(part.thinking) }];
        if (part?.type === "tool_use" && typeof part.id === "string") return [{ type: "toolCall", id: part.id, name: String(part.name || "tool"), arguments: boundedInput(part.input) }];
        return [];
      }) : [];
      if (content.length) messages.push({ role: "assistant", id: entry.uuid || message.id, content, timestamp });
      continue;
    }
    const blocks = Array.isArray(message.content) ? message.content : null;
    if (blocks) {
      for (const part of blocks) {
        if (part?.type !== "tool_result" || typeof part.tool_use_id !== "string") continue;
        const resultText = typeof part.content === "string" ? part.content : text(part.content) || JSON.stringify(part.content ?? "");
        messages.push({
          role: "toolResult",
          toolCallId: part.tool_use_id,
          toolName: "Claude tool",
          content: [{ type: "text", text: clip(resultText) }],
          isError: part.is_error === true,
          timestamp,
        });
      }
    }
    const body = text(message.content);
    if (body && !entry.isSynthetic) messages.push({ role: "user", id: entry.uuid, content: [{ type: "text", text: body }], timestamp });
  }
  return messages.slice(-1500);
}

function boundedHistory(messages) {
  const kept = [];
  let bytes = 2;
  for (let index = messages.length - 1; index >= 0; index--) {
    const serialized = JSON.stringify(messages[index]);
    if (bytes + Buffer.byteLength(serialized) + 1 > 1500000) continue;
    kept.unshift(messages[index]);
    bytes += Buffer.byteLength(serialized) + 1;
  }
  return kept;
}

async function metadata(file, requestedCwd) {
  const entries = await readEntries(file);
  const cwd = entryCwd(entries);
  if (!cwd) return null;
  let actual;
  try { actual = fs.realpathSync(cwd); } catch { actual = path.resolve(cwd); }
  if (actual !== requestedCwd) return null;
  const id = path.basename(file, ".jsonl");
  let name = null;
  let firstMessage = null;
  let model = null;
  let modeId = null;
  let createdAt = null;
  for (const entry of entries) {
    if (entry.type === "custom-title" && typeof entry.customTitle === "string" && entry.customTitle.trim()) name = entry.customTitle.trim();
    if (entry.type === "permission-mode" && typeof entry.permissionMode === "string") modeId = entry.permissionMode;
    if (!createdAt && typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp))) createdAt = Date.parse(entry.timestamp);
    if (!firstMessage && entry.type === "user" && !entry.isSynthetic && entry.message) firstMessage = text(entry.message.content) || null;
    if (entry.type === "assistant" && typeof entry.message?.model === "string") model = entry.message.model;
  }
  const stat = await fsp.stat(file);
  return {
    providerSessionId: id,
    providerSessionPath: file,
    name,
    firstMessage,
    messageCount: normalized(entries).length,
    createdAt,
    modifiedAt: stat.mtimeMs,
    ...((model || modeId) ? { launchConfig: { ...(model ? { model } : {}), ...(modeId ? { modeId } : {}) } } : {}),
  };
}

(async () => {
  if (mode === "history") {
    process.stdout.write(JSON.stringify(boundedHistory(normalized(await readEntries(input)))));
    return;
  }
  let requestedCwd;
  try { requestedCwd = fs.realpathSync(input); } catch { requestedCwd = path.resolve(input); }
  const ranked = await Promise.all((await files(root)).map(async (file) => ({ file, mtime: (await fsp.stat(file)).mtimeMs })));
  ranked.sort((a, b) => b.mtime - a.mtime);
  const result = [];
  for (const item of ranked) {
    if (result.length >= 200) break;
    try { const value = await metadata(item.file, requestedCwd); if (value) result.push(value); } catch {}
  }
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`.trim();

export async function listClaudeWorkspaceSessions(
  target: HostTarget,
  workspacePath: string,
): Promise<AgentProviderSessionMetadata[]> {
  const result = await executeOnHost(
    target,
    { command: "node", args: ["-e", CLAUDE_SESSION_SCRIPT, "list", workspacePath] },
    { timeoutMs: SESSION_TIMEOUT_MS },
  );
  return metadataSchema.parse(JSON.parse(result.stdout)).map((session) => ({
    ...session,
    createdAt: session.createdAt === null ? null : new Date(session.createdAt),
    modifiedAt: session.modifiedAt === null ? null : new Date(session.modifiedAt),
  }));
}

export async function readClaudeSessionMessages(
  target: HostTarget,
  providerSessionPath: string,
): Promise<unknown[]> {
  if (!providerSessionPath.endsWith(".jsonl")) return [];
  const result = await executeOnHost(
    target,
    { command: "node", args: ["-e", CLAUDE_SESSION_SCRIPT, "history", providerSessionPath] },
    { timeoutMs: SESSION_TIMEOUT_MS },
  );
  return historySchema.parse(JSON.parse(result.stdout));
}

export async function renameClaudeSession(
  target: HostTarget,
  providerSessionPath: string,
  sessionId: string,
  title: string,
): Promise<void> {
  const script = String.raw`
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const entry = { type: "custom-title", customTitle: process.argv[2], sessionId: process.argv[1], uuid: crypto.randomUUID(), timestamp: new Date().toISOString() };
let file = process.argv[3];
if (!file.endsWith(".jsonl")) {
  const root = process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, "projects")
    : path.join(os.homedir(), ".claude", "projects");
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const candidate = path.join(root, project.name, process.argv[1] + ".jsonl");
    if (fs.existsSync(candidate)) { file = candidate; break; }
  }
}
if (!file.endsWith(".jsonl")) throw new Error("Claude session history is not available for rename yet.");
fs.appendFileSync(file, JSON.stringify(entry) + "\n");
`;
  await executeOnHost(target, {
    command: "node",
    args: ["-e", script, sessionId, title, providerSessionPath],
  });
}
