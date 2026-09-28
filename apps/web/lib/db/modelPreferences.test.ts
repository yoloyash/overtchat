import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./client", () => fixture);
const raw = new Database(":memory:");
raw.pragma("foreign_keys = ON");
fixture.db = drizzle(raw);
migrate(fixture.db as ReturnType<typeof drizzle>, {
  migrationsFolder: path.resolve("drizzle"),
});
const { getModelPreferences, setModelFavorite } =
  await import("./modelPreferences");

beforeEach(() => {
  raw.exec(`DELETE FROM messages; DELETE FROM chats; DELETE FROM user; DELETE FROM model_configs;
    INSERT INTO user (id, name, email) VALUES ('a', 'A', 'a@example.test'), ('b', 'B', 'b@example.test');
    INSERT INTO model_configs (id, label, base_url, model, enabled, model_type) VALUES
      ('one', 'One', 'https://example.test', 'one', 1, 'chat'),
      ('two', 'Two', 'https://example.test', 'two', 1, 'chat'),
      ('hidden', 'Hidden', 'https://example.test', 'hidden', 0, 'chat'),
      ('image', 'Image', 'https://example.test', 'image', 1, 'image');`);
});

it("persists multiple independent favorites per user and removes only the requested favorite", () => {
  expect(getModelPreferences("a")).toEqual({ favoriteModelIds: [] });
  setModelFavorite("a", "one", true);
  setModelFavorite("a", "two", true);
  setModelFavorite("a", "one", true);
  setModelFavorite("b", "two", true);
  expect(getModelPreferences("a")).toEqual({
    favoriteModelIds: ["one", "two"],
  });
  expect(getModelPreferences("b")).toEqual({ favoriteModelIds: ["two"] });
  setModelFavorite("a", "two", false);
  setModelFavorite("a", "two", false);
  expect(getModelPreferences("a")).toEqual({ favoriteModelIds: ["one"] });
  expect(getModelPreferences("b")).toEqual({ favoriteModelIds: ["two"] });
});

it("cleans up favorites when a model or user is deleted", () => {
  setModelFavorite("a", "one", true);
  setModelFavorite("a", "two", true);
  raw.exec(
    "INSERT INTO chats (id, user_id, model_config_id) VALUES ('saved', 'a', 'one')",
  );
  raw.exec("DELETE FROM model_configs WHERE id = 'one'");
  expect(getModelPreferences("a")).toEqual({ favoriteModelIds: ["two"] });
  expect(
    raw.prepare("SELECT model_config_id FROM chats WHERE id = 'saved'").get(),
  ).toEqual({ model_config_id: null });
  raw.exec("DELETE FROM user WHERE id = 'a'");
  expect(
    raw.prepare("SELECT * FROM user_model_favorites WHERE user_id = 'a'").get(),
  ).toBeUndefined();
});

it("rejects unavailable additions and allows removing favorites after disabling a model", () => {
  setModelFavorite("a", "one", true);
  for (const id of ["hidden", "missing", "image"])
    expect(setModelFavorite("a", id, true)).toBeNull();
  expect(getModelPreferences("a")).toEqual({ favoriteModelIds: ["one"] });
  raw.exec("UPDATE model_configs SET enabled = 0 WHERE id = 'one'");
  expect(setModelFavorite("a", "one", false)).toEqual({ favoriteModelIds: [] });
});

it("backfills the latest exact or unambiguous legacy model without guessing duplicates", () => {
  raw.exec(`INSERT INTO model_configs (id, label, base_url, model) VALUES ('duplicate', 'Duplicate', 'https://example.test', 'two');
    INSERT INTO chats (id, user_id) VALUES ('exact', 'a'), ('legacy', 'a'), ('ambiguous', 'a');`);
  const insert = raw.prepare(
    "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at) VALUES (?, ?, 'assistant', '[]', ?, ?)",
  );
  insert.run(
    "old",
    "exact",
    JSON.stringify({ contextEstimate: { modelConfigId: "one" } }),
    1,
  );
  insert.run(
    "latest",
    "exact",
    JSON.stringify({ contextEstimate: { modelConfigId: "two" } }),
    2,
  );
  insert.run(
    "legacy",
    "legacy",
    JSON.stringify({ stats: { model: "one" } }),
    1,
  );
  insert.run(
    "ambiguous",
    "ambiguous",
    JSON.stringify({ stats: { model: "two" } }),
    1,
  );
  const sql = readFileSync(
    path.resolve("drizzle/0018_model_favorites.sql"),
    "utf8",
  );
  raw.exec(sql.slice(sql.indexOf("WITH latest_models")));
  expect(
    raw.prepare("SELECT id, model_config_id FROM chats ORDER BY id").all(),
  ).toEqual([
    { id: "ambiguous", model_config_id: null },
    { id: "exact", model_config_id: "two" },
    { id: "legacy", model_config_id: "one" },
  ]);
});
