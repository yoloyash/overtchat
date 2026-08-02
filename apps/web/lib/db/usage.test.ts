import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-usage-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.exec(`
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    image TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE generation_usage (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    chat_id TEXT,
    message_id TEXT,
    context TEXT NOT NULL DEFAULT 'chat',
    occurred_at INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    uncached_input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    total_tokens INTEGER,
    cost_source TEXT,
    input_cost_nano_usd INTEGER,
    output_cost_nano_usd INTEGER,
    cache_read_cost_nano_usd INTEGER,
    cache_write_cost_nano_usd INTEGER,
    total_cost_nano_usd INTEGER,
    finish_reason TEXT
  );
`);
raw.exec(`
  INSERT INTO user (id, name, image, created_at) VALUES
    ('alice', 'Alice', 'alice.png', 1000),
    ('bob', 'Bob', NULL, 2000);
`);

const insertUsage = raw.prepare(`
  INSERT INTO generation_usage (
    id,
    user_id,
    chat_id,
    context,
    occurred_at,
    provider_id,
    model,
    input_tokens,
    uncached_input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_write_tokens,
    total_tokens,
    cost_source,
    input_cost_nano_usd,
    output_cost_nano_usd,
    cache_read_cost_nano_usd,
    cache_write_cost_nano_usd,
    total_cost_nano_usd,
    finish_reason
  ) VALUES (
    @id,
    @userId,
    @chatId,
    @context,
    @occurredAt,
    @providerId,
    @model,
    @inputTokens,
    @uncachedInputTokens,
    @outputTokens,
    @cacheReadTokens,
    @cacheWriteTokens,
    @totalTokens,
    @costSource,
    @inputCostNanoUsd,
    @outputCostNanoUsd,
    @cacheReadCostNanoUsd,
    @cacheWriteCostNanoUsd,
    @totalCostNanoUsd,
    'stop'
  )
`);

insertUsage.run({
  id: "alice-one",
  userId: "alice",
  chatId: "alice-chat",
  context: "chat",
  occurredAt: Date.parse("2026-07-30T01:00:00.000Z"),
  providerId: "anthropic",
  model: "claude-sonnet",
  inputTokens: 100,
  uncachedInputTokens: 20,
  outputTokens: 20,
  cacheReadTokens: 80,
  cacheWriteTokens: 5,
  totalTokens: 120,
  costSource: "models.dev",
  inputCostNanoUsd: 1_000,
  outputCostNanoUsd: 2_000,
  cacheReadCostNanoUsd: 300,
  cacheWriteCostNanoUsd: 400,
  totalCostNanoUsd: 3_700,
});
insertUsage.run({
  id: "alice-two",
  userId: "alice",
  chatId: "alice-chat",
  context: "chat",
  occurredAt: Date.parse("2026-07-30T23:00:00.000Z"),
  providerId: "anthropic",
  model: "claude-sonnet",
  inputTokens: 50,
  uncachedInputTokens: null,
  outputTokens: 10,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalTokens: null,
  costSource: null,
  inputCostNanoUsd: null,
  outputCostNanoUsd: null,
  cacheReadCostNanoUsd: null,
  cacheWriteCostNanoUsd: null,
  totalCostNanoUsd: null,
});
insertUsage.run({
  id: "bob-one",
  userId: "bob",
  chatId: "bob-chat",
  context: "chat",
  occurredAt: Date.parse("2026-07-29T12:00:00.000Z"),
  providerId: "openai",
  model: "gpt",
  inputTokens: 400,
  uncachedInputTokens: 400,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 500,
  costSource: "models.dev",
  inputCostNanoUsd: 4_000,
  outputCostNanoUsd: 1_000,
  cacheReadCostNanoUsd: 0,
  cacheWriteCostNanoUsd: 0,
  totalCostNanoUsd: 5_000,
});
insertUsage.run({
  id: "alice-title",
  userId: "alice",
  chatId: "alice-chat",
  context: "title",
  occurredAt: Date.parse("2026-07-28T12:00:00.000Z"),
  providerId: "anthropic",
  model: "claude-sonnet",
  inputTokens: 10_000,
  uncachedInputTokens: 10_000,
  outputTokens: 1_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 11_000,
  costSource: "models.dev",
  inputCostNanoUsd: 100_000,
  outputCostNanoUsd: 50_000,
  cacheReadCostNanoUsd: 0,
  cacheWriteCostNanoUsd: 0,
  totalCostNanoUsd: 150_000,
});

let usage: typeof import("./usage");

beforeAll(async () => {
  usage = await import("./usage");
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

describe("chat usage aggregates", () => {
  it("ranks all users and applies an inclusive/exclusive date range", async () => {
    await expect(usage.listUsageLeaderboard()).resolves.toEqual([
      expect.objectContaining({
        userId: "bob",
        name: "Bob",
        generations: 1,
        totalTokens: 500,
      }),
      {
        userId: "alice",
        name: "Alice",
        image: "alice.png",
        generations: 2,
        pricedGenerations: 1,
        inputTokens: 150,
        uncachedInputTokens: 20,
        outputTokens: 30,
        cacheReadTokens: 80,
        cacheWriteTokens: 5,
        totalTokens: 180,
        inputCostNanoUsd: 1_000,
        outputCostNanoUsd: 2_000,
        cacheReadCostNanoUsd: 300,
        cacheWriteCostNanoUsd: 400,
        totalCostNanoUsd: 3_700,
      },
    ]);

    await expect(
      usage.listUsageLeaderboard({
        from: new Date("2026-07-30T00:00:00.000Z"),
        to: new Date("2026-07-31T00:00:00.000Z"),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        userId: "alice",
        generations: 2,
        totalTokens: 180,
      }),
      expect.objectContaining({
        userId: "bob",
        generations: 0,
        totalTokens: 0,
      }),
    ]);
  });

  it("groups model usage and falls back to input plus output totals", async () => {
    await expect(usage.listUserModelUsage("alice")).resolves.toEqual([
      {
        providerId: "anthropic",
        model: "claude-sonnet",
        generations: 2,
        pricedGenerations: 1,
        inputTokens: 150,
        uncachedInputTokens: 20,
        outputTokens: 30,
        cacheReadTokens: 80,
        cacheWriteTokens: 5,
        totalTokens: 180,
        inputCostNanoUsd: 1_000,
        outputCostNanoUsd: 2_000,
        cacheReadCostNanoUsd: 300,
        cacheWriteCostNanoUsd: 400,
        totalCostNanoUsd: 3_700,
      },
    ]);
  });

  it("groups activity by the requested time zone", async () => {
    await expect(
      usage.listUserDailyUsage("alice", {
        timeZone: "America/Los_Angeles",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        date: "2026-07-29",
        generations: 1,
        totalTokens: 120,
      }),
      expect.objectContaining({
        date: "2026-07-30",
        generations: 1,
        totalTokens: 60,
      }),
    ]);
  });

  it("returns owner-scoped response usage without hidden title work", async () => {
    await expect(
      usage.getChatUsageTotals("alice-chat", "alice"),
    ).resolves.toEqual({
      generations: 2,
      pricedGenerations: 1,
      inputTokens: 150,
      uncachedInputTokens: 20,
      outputTokens: 30,
      cacheReadTokens: 80,
      cacheWriteTokens: 5,
      totalTokens: 180,
      inputCostNanoUsd: 1_000,
      outputCostNanoUsd: 2_000,
      cacheReadCostNanoUsd: 300,
      cacheWriteCostNanoUsd: 400,
      totalCostNanoUsd: 3_700,
    });
    await expect(
      usage.getChatUsageTotals("alice-chat", "bob"),
    ).resolves.toEqual({
      generations: 0,
      pricedGenerations: 0,
      inputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      inputCostNanoUsd: 0,
      outputCostNanoUsd: 0,
      cacheReadCostNanoUsd: 0,
      cacheWriteCostNanoUsd: 0,
      totalCostNanoUsd: 0,
    });
  });

  it("loads person metadata, all-time totals, and tracking start", async () => {
    await expect(usage.getUsageMember("alice")).resolves.toEqual({
      id: "alice",
      name: "Alice",
      image: "alice.png",
      createdAt: new Date(1_000),
    });
    await expect(usage.getUsageMember("missing")).resolves.toBeNull();
    await expect(usage.getUserUsageTotals("alice")).resolves.toEqual({
      generations: 2,
      pricedGenerations: 1,
      inputTokens: 150,
      uncachedInputTokens: 20,
      outputTokens: 30,
      cacheReadTokens: 80,
      cacheWriteTokens: 5,
      totalTokens: 180,
      inputCostNanoUsd: 1_000,
      outputCostNanoUsd: 2_000,
      cacheReadCostNanoUsd: 300,
      cacheWriteCostNanoUsd: 400,
      totalCostNanoUsd: 3_700,
    });
    await expect(usage.getUsageTrackingStart("alice")).resolves.toEqual(
      new Date("2026-07-30T01:00:00.000Z"),
    );
    await expect(usage.getUsageTrackingStart()).resolves.toEqual(
      new Date("2026-07-29T12:00:00.000Z"),
    );
  });
});
