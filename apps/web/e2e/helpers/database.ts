import Database from "better-sqlite3";
import path from "node:path";

const TEST_DB_PATH = path.resolve(__dirname, "../../data/test.db");

export function openE2eDatabase() {
  const db = new Database(TEST_DB_PATH);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function resetE2eDatabase() {
  const db = openE2eDatabase();
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM messages").run();
      db.prepare("DELETE FROM messages_fts").run();
      db.prepare("DELETE FROM chats").run();
      db.prepare("DELETE FROM projects").run();
      db.prepare("DELETE FROM uploads").run();
      db.prepare("DELETE FROM account").run();
      db.prepare("DELETE FROM session").run();
      db.prepare("DELETE FROM verification").run();
      db.prepare("DELETE FROM user").run();
      db.prepare("DELETE FROM model_configs").run();
    })();
  } finally {
    db.close();
  }
}
