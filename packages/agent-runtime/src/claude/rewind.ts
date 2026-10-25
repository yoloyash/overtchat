import { randomUUID } from "node:crypto";
import { forkSession, type SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { executeOnHost, type HostTarget } from "../runtime/process";

// Fork the complete native transcript, not the clipped display history. The
// SDK owns chain selection and UUID remapping; this store only transports bytes
// to/from the execution host, including hosts without an installed Node SDK.
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const STORE_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const [mode, input, id] = process.argv.slice(1);
const limit = 64 * 1024 * 1024;
(async () => {
  if (mode === "load") {
    let file = input;
    if (!file.endsWith(".jsonl")) {
      const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
      file = fs.readdirSync(root, { withFileTypes: true }).filter((p) => p.isDirectory())
        .map((p) => path.join(root, p.name, input + ".jsonl")).find((p) => fs.existsSync(p));
    }
    if (!file) throw new Error("Claude session transcript is missing.");
    const fd = fs.openSync(file, "r");
    try {
      if (fs.fstatSync(fd).size > limit) throw new Error("Claude transcript exceeds the 64 MiB rewind limit.");
      const text = fs.readFileSync(fd, "utf8");
      process.stdout.write(JSON.stringify(file) + "\n" + text);
    } finally { fs.closeSync(fd); }
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid Claude fork session ID.");
    const nativeFile = path.join(path.dirname(input), id + ".jsonl");
    const file = mode === "empty" ? nativeFile + ".overtchat-empty" : nativeFile;
    const temporary = file + "." + require("node:crypto").randomUUID() + ".tmp";
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      let total = 0;
      for await (const buffer of process.stdin) {
        const count = buffer.length;
        total += count;
        if (total > limit) throw new Error("Claude fork exceeds the 64 MiB rewind limit.");
        let offset = 0;
        while (offset < count) offset += fs.writeSync(fd, buffer, offset, count - offset);
      }
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      // Publish only the complete transcript, and never overwrite another session.
      fs.linkSync(temporary, file);
      process.stdout.write(JSON.stringify(nativeFile));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      fs.rmSync(temporary, { force: true });
    }
  }
})().catch((error) => {
  process.stderr.write(error.message);
  process.exitCode = 1;
});
`.trim();

export async function forkClaudeSession(
  target: HostTarget,
  sourceId: string,
  sourcePath: string,
  cwd: string,
  upToMessageId?: string,
): Promise<{ providerSessionId: string; providerSessionPath: string }> {
  let transcriptPath: string | undefined;
  let forkPath: string | undefined;
  const load = async (): Promise<SessionStoreEntry[]> => {
    const { stdout } = await executeOnHost(target, {
      command: "node", args: ["-e", STORE_SCRIPT, "load", sourcePath],
    }, { timeoutMs: 60_000, maxCaptureBytes: MAX_TRANSCRIPT_BYTES + 64 * 1024 });
    const newline = stdout.indexOf("\n");
    transcriptPath = JSON.parse(stdout.slice(0, newline)) as string;
    return stdout.slice(newline + 1).split("\n").flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        return entry && typeof entry.type === "string" ? [entry as SessionStoreEntry] : [];
      } catch { return []; }
    });
  };
  const append = async ({ sessionId }: { sessionId: string }, entries: SessionStoreEntry[]) => {
    if (!transcriptPath || forkPath) throw new Error("Invalid Claude fork write.");
    const stdin = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    if (Buffer.byteLength(stdin) > MAX_TRANSCRIPT_BYTES) {
      throw new Error("Claude fork exceeds the 64 MiB rewind limit.");
    }
    const { stdout } = await executeOnHost(target, {
      command: "node", args: ["-e", STORE_SCRIPT, upToMessageId ? "write" : "empty", transcriptPath, sessionId],
    }, { timeoutMs: 60_000, stdin });
    forkPath = JSON.parse(stdout) as string;
  };
  let sessionId: string;
  if (upToMessageId) {
    ({ sessionId } = await forkSession(sourceId, {
      upToMessageId, sessionStore: { load, append },
    }));
  } else {
    // Claude cannot resume a transcript with no messages. Persist that intent
    // explicitly so reopening starts this same ID fresh until its first turn.
    await load();
    sessionId = randomUUID();
    await append({ sessionId }, [{ type: "overtchat-empty-session", sessionId, cwd }]);
  }
  if (!forkPath) throw new Error("Claude did not persist the forked transcript.");
  return { providerSessionId: sessionId, providerSessionPath: forkPath };
}
