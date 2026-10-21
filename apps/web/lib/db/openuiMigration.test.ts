import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("backfills OpenUI text without losing existing indexed content or changing ownership", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE chats (id TEXT PRIMARY KEY, user_id TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT, parts TEXT);
      CREATE VIRTUAL TABLE messages_fts USING fts5(content, message_id UNINDEXED, chat_id UNINDEXED, user_id UNINDEXED);
      CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN DELETE FROM messages_fts WHERE message_id = old.id; END;
      INSERT INTO chats VALUES ('c', 'owner');
      INSERT INTO messages_fts VALUES ('Existing prose', 'a', 'c', 'owner');`);
    const insert = db.prepare("INSERT INTO messages VALUES (?, 'c', ?)");
    insert.run(
      "a",
      JSON.stringify([
        { type: "tool-present_openui", output: { text: "Revenue 42" } },
      ]),
    );
    insert.run(
      "b",
      JSON.stringify([
        { type: "tool-present_openui", input: { text: "Bookings Kyoto" } },
      ]),
    );
    insert.run(
      "bad",
      JSON.stringify([{ type: "tool-present_openui", input: { ui: 42 } }]),
    );
    insert.run(
      "legacy",
      JSON.stringify([
        {
          type: "tool-present_openui",
          input: { ui: 'root = Card([TextContent("Osaka")])' },
        },
      ]),
    );
    db.exec(readFileSync("drizzle/0023_openui_search.sql", "utf8"));
    expect(
      db
        .prepare("SELECT content FROM messages_fts WHERE message_id = 'a'")
        .get(),
    ).toEqual({ content: "Existing prose\nRevenue 42" });
    expect(
      db
        .prepare(
          "SELECT message_id, user_id FROM messages_fts WHERE messages_fts MATCH 'Kyoto'",
        )
        .all(),
    ).toEqual([{ message_id: "b", user_id: "owner" }]);
    expect(
      db
        .prepare(
          "SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'Osaka'",
        )
        .all(),
    ).toEqual([{ message_id: "legacy" }]);
    expect(
      db.prepare("SELECT count(*) AS count FROM messages_fts").get(),
    ).toEqual({ count: 3 });
    db.exec("DELETE FROM messages WHERE id = 'b'");
    expect(
      db
        .prepare(
          "SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'Kyoto'",
        )
        .all(),
    ).toEqual([]);
  } finally {
    db.close();
  }
});
