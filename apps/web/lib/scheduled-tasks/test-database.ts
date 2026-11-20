import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

/** A migrated in-memory database with two people and a few models, for tests. */
export function createTestDatabase() {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  const db = drizzle(raw);
  migrate(db, { migrationsFolder: path.resolve("drizzle") });
  const reset = () =>
    raw.exec(`DELETE FROM scheduled_task_runs; DELETE FROM scheduled_tasks;
      DELETE FROM chat_generations; DELETE FROM chats; DELETE FROM projects;
      DELETE FROM user; DELETE FROM model_configs;
      INSERT INTO user (id, name, email) VALUES ('a', 'A', 'a@example.test'), ('b', 'B', 'b@example.test');
      INSERT INTO projects (id, user_id, name) VALUES ('p', 'a', 'Project'), ('other', 'b', 'Theirs');
      INSERT INTO model_configs (id, label, base_url, model, enabled, model_type) VALUES
        ('one', 'One', 'https://example.test', 'one', 1, 'chat'),
        ('two', 'Two', 'https://example.test', 'two', 1, 'chat'),
        ('hidden', 'Hidden', 'https://example.test', 'hidden', 0, 'chat'),
        ('image', 'Image', 'https://example.test', 'image', 1, 'image');`);
  return { raw, db, reset };
}
