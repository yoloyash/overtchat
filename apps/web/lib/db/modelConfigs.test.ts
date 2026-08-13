import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-model-configs-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.exec(`
  CREATE TABLE model_configs (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    provider_id TEXT DEFAULT 'custom' NOT NULL,
    api_format TEXT DEFAULT 'openai-chat' NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT,
    model TEXT NOT NULL,
    pricing TEXT,
    context_window INTEGER,
    discovered_context_window INTEGER,
    discovered_capabilities TEXT,
    system_prompt TEXT,
    provider_options TEXT,
    tool_calling_enabled INTEGER DEFAULT true NOT NULL,
    enabled INTEGER DEFAULT true NOT NULL,
    task_model INTEGER DEFAULT false NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE UNIQUE INDEX model_configs_taskModel_idx
    ON model_configs (task_model)
    WHERE task_model = true;
`);

let modelConfigDb: typeof import("./modelConfigs");

beforeAll(async () => {
  modelConfigDb = await import("./modelConfigs");
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM model_configs;
    INSERT INTO model_configs (id, label, base_url, model, enabled)
    VALUES
      ('chat-model', 'Chat model', 'https://example.test/v1', 'chat', true),
      ('hidden-model', 'Hidden model', 'https://example.test/v1', 'hidden', false);
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

describe("task model assignment", () => {
  it("assigns a model that is hidden from chat", () => {
    const result = modelConfigDb.setTaskModelConfig("hidden-model");

    expect(result).toMatchObject({
      status: "updated",
      modelConfig: {
        id: "hidden-model",
        enabled: false,
        taskModel: true,
      },
    });
    expect(modelConfigDb.getTaskModelConfig()?.id).toBe("hidden-model");
  });

  it("atomically replaces the previous assignment", () => {
    modelConfigDb.setTaskModelConfig("chat-model");
    modelConfigDb.setTaskModelConfig("hidden-model");

    expect(modelConfigDb.getTaskModelConfig()?.id).toBe("hidden-model");
    expect(
      raw
        .prepare("SELECT count(*) AS count FROM model_configs WHERE task_model = true")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("keeps the current assignment when the requested model is missing", () => {
    modelConfigDb.setTaskModelConfig("chat-model");

    expect(modelConfigDb.setTaskModelConfig("missing")).toEqual({
      status: "not_found",
    });
    expect(modelConfigDb.getTaskModelConfig()?.id).toBe("chat-model");
  });

  it("clears back to the active chat model fallback", () => {
    modelConfigDb.setTaskModelConfig("chat-model");

    expect(modelConfigDb.setTaskModelConfig(null)).toEqual({
      status: "updated",
      modelConfig: null,
    });
    expect(modelConfigDb.getTaskModelConfig()).toBeNull();
  });

  it("returns to fallback when the assigned model is deleted", async () => {
    modelConfigDb.setTaskModelConfig("hidden-model");

    await modelConfigDb.deleteModelConfig("hidden-model");

    expect(modelConfigDb.getTaskModelConfig()).toBeNull();
  });
});
