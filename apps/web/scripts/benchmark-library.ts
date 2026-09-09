import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, cpus } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

// Run from apps/web via npm run bench:library. Always uses synthetic data in a
// disposable database; DATABASE_URL from the caller is deliberately ignored.
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "overtchat-library-bench-"));
  process.env.DATABASE_URL = path.join(directory, "benchmark.db");
  process.env.MIGRATIONS_FOLDER = path.resolve("drizzle");
  const { db } = await import("../lib/db/client");
  try {
    const { runMigrations } = await import("../lib/db/migrate");
    const { listLibrary } = await import("../lib/db/library");
    runMigrations();
    const sqlite = db.$client;
    const insertChat = sqlite.prepare("INSERT INTO chats (id, user_id, title) VALUES (?, 'benchmark', 'Synthetic chat')");
    const insertMessage = sqlite.prepare("INSERT INTO messages (id, chat_id, role, parts) VALUES (?, ?, ?, ?)");
    const insertUpload = sqlite.prepare(`INSERT INTO uploads
      (id, user_id, filename, media_type, category, size, created_at)
      VALUES (?, 'benchmark', ?, 'text/plain', 'text', 1024, ?)`);
    console.log(JSON.stringify({
      cpu: cpus()[0]?.model, node: process.version,
      sqlite: sqlite.prepare("SELECT sqlite_version() AS version").get(),
      method: "Actual listLibrary query; production migrations/indexes; disk-backed WAL; 1 warm-up + 7 timed sequential calls; no HTTP or UI; 20 user/assistant pairs per chat; one upload every 20 user messages; assistant text 4 KiB; OS cache not flushed.",
    }));

    async function measure(run: () => Promise<unknown>) {
      await run();
      const times = [];
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        await run();
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return { medianMs: +times[3].toFixed(1), maxMs: +times[6].toFixed(1) };
    }

    for (const userTextBytes of [1024, 8192]) {
      sqlite.prepare("DELETE FROM user WHERE id = 'benchmark'").run();
      sqlite.prepare("INSERT INTO user (id, name, email) VALUES ('benchmark', 'Synthetic', 'synthetic@example.invalid')").run();
      let seeded = 0;
      let messageJsonBytes = 0;
      const userText = "x".repeat(userTextBytes);
      const assistantParts = JSON.stringify([{ type: "text", text: "y".repeat(4096) }]);
      for (const userMessages of [1000, 10_000, 50_000, 100_000]) {
        sqlite.transaction(() => {
          for (let i = seeded; i < userMessages; i++) {
            const chatId = `chat-${Math.floor(i / 20)}`;
            if (i % 20 === 0) insertChat.run(chatId);
            const parts: unknown[] = [{ type: "text", text: userText }];
            if (i % 20 === 0) {
              const id = `file-${String(i).padStart(8, "0")}`;
              const filename = i % 40 === 0 ? `RÉSUMÉ-${i}.txt` : `notes-${i}.txt`;
              insertUpload.run(id, filename, 1_700_000_000_000 + i);
              parts.push({ type: "file", url: `/api/uploads/${id}`, filename, mediaType: "text/plain" });
            }
            const userParts = JSON.stringify(parts);
            insertMessage.run(`user-${i}`, chatId, "user", userParts);
            insertMessage.run(`assistant-${i}`, chatId, "assistant", assistantParts);
            messageJsonBytes += Buffer.byteLength(userParts) + Buffer.byteLength(assistantParts);
          }
        })();
        seeded = userMessages;
        sqlite.pragma("wal_checkpoint(TRUNCATE)");
        const first = await listLibrary("benchmark");
        console.log(JSON.stringify({
          userTextBytes, userMessages, totalMessages: userMessages * 2,
          chats: userMessages / 20, uploads: userMessages / 20,
          messageJsonMiB: +(messageJsonBytes / 1024 ** 2).toFixed(1),
          browse: await measure(() => listLibrary("benchmark")),
          unicodeSearch: await measure(() => listLibrary("benchmark", "résumé")),
          nextPage: await measure(() => listLibrary("benchmark", "", JSON.parse(first.nextCursor!))),
        }));
      }
    }
  } finally {
    db.$client.close();
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
