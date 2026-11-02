import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function claudeRewindFixture(large = false) {
  const root = await mkdtemp(join(tmpdir(), "overtchat-claude-rewind-"));
  const cwd = join(root, "workspace");
  const config = join(root, "config");
  const project = join(config, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  await mkdir(project, { recursive: true });
  await mkdir(cwd);
  const sessionId = randomUUID();
  const ids: string[] = Array.from({ length: 6 }, () => randomUUID());
  const entries = ids.map((uuid, index) => ({
    type: index % 2 ? "assistant" : "user",
    uuid, parentUuid: ids[index - 1] ?? null,
    sessionId, cwd, version: "2.1.301", isSidechain: false,
    timestamp: new Date(1_790_000_000_000 + index * 1000).toISOString(),
    message: index % 2 ? {
      id: `msg_${uuid}`, type: "message", role: "assistant", model: "claude-sonnet-4-6",
      content: [{ type: "text", text: `Answer ${index}` }],
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } : { role: "user", content: `Question ${index}` },
  }));
  const sessionPath = join(project, `${sessionId}.jsonl`);
  const lines = entries.map((entry) => JSON.stringify(entry));
  if (large) lines.unshift(JSON.stringify({ type: "api-request-blob", data: "x".repeat(3 * 1024 * 1024) }));
  await writeFile(sessionPath, lines.join("\n") + "\n");
  return { root, cwd, config, project, sessionId, sessionPath, ids, entries };
}
