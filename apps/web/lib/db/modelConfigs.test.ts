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

import { ModelConfigSchema } from "@/lib/model-config/schema";

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
    model_type TEXT DEFAULT 'chat' NOT NULL,
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
    credential_scope TEXT DEFAULT 'shared' NOT NULL,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE UNIQUE INDEX model_configs_activeImage_idx ON model_configs (enabled) WHERE model_type = 'image' AND enabled = true;
  CREATE UNIQUE INDEX model_configs_taskModel_idx
    ON model_configs (task_model)
    WHERE task_model = true;
  CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE model_config_user_credentials (
    model_config_id TEXT NOT NULL REFERENCES model_configs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    api_key TEXT,
    base_url TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    PRIMARY KEY (model_config_id, user_id)
  );
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

it("saves configured order atomically and rejects duplicate, missing, or unknown IDs", async () => {
  expect(
    modelConfigDb.reorderModelConfigs(["hidden-model", "chat-model"]),
  ).toBe(true);
  expect(
    (await modelConfigDb.listModelConfigs()).map((model) => model.id),
  ).toEqual(["hidden-model", "chat-model"]);
  for (const ids of [
    ["chat-model"],
    ["chat-model", "chat-model"],
    ["chat-model", "missing"],
  ]) {
    expect(modelConfigDb.reorderModelConfigs(ids)).toBe(false);
    expect(
      (await modelConfigDb.listModelConfigs()).map((model) => model.id),
    ).toEqual(["hidden-model", "chat-model"]);
  }
});

it("appends new models and preserves order when an old editor submits a configuration", async () => {
  modelConfigDb.reorderModelConfigs(["hidden-model", "chat-model"]);
  const input = ModelConfigSchema.parse({
    label: "A new model",
    providerId: "custom",
    apiFormat: "openai-chat",
    baseUrl: "https://example.test/v1",
    model: "new",
    sortOrder: 0,
  });
  const created = await modelConfigDb.createModelConfig(input);
  expect(
    (await modelConfigDb.listModelConfigs()).map((model) => model.id),
  ).toEqual(["hidden-model", "chat-model", created.id]);
  await modelConfigDb.updateModelConfig("chat-model", input);
  expect(
    (await modelConfigDb.listModelConfigs()).map((model) => model.id),
  ).toEqual(["hidden-model", "chat-model", created.id]);
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
        .prepare(
          "SELECT count(*) AS count FROM model_configs WHERE task_model = true",
        )
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

describe("image model selection", () => {
  const input = ModelConfigSchema.parse({
    label: "Pictures",
    modelType: "image",
    providerId: "openai",
    apiFormat: "auto",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-image-1",
  });

  it("switches a single enabled image model while preserving chat and task models", async () => {
    modelConfigDb.setTaskModelConfig("chat-model");
    const first = await modelConfigDb.createModelConfig(input);
    const second = await modelConfigDb.createModelConfig({
      ...input,
      model: "gpt-image-1.5",
    });
    expect((await modelConfigDb.getModelConfig(first.id))?.enabled).toBe(false);
    expect(modelConfigDb.getImageModelConfig()?.id).toBe(second.id);
    expect((await modelConfigDb.getModelConfig("chat-model"))?.enabled).toBe(
      true,
    );
    expect(modelConfigDb.getTaskModelConfig()?.id).toBe("chat-model");
    await modelConfigDb.updateModelConfig(first.id, input);
    expect((await modelConfigDb.getModelConfig(second.id))?.enabled).toBe(
      false,
    );
    expect(modelConfigDb.getImageModelConfig()?.id).toBe(first.id);
    expect(() =>
      raw
        .prepare("UPDATE model_configs SET enabled = true WHERE id = ?")
        .run(second.id),
    ).toThrow(/UNIQUE/);
  });

  it("allows disabling or deleting the last image model, and rejects image task assignment", async () => {
    const image = await modelConfigDb.createModelConfig(input);
    expect(modelConfigDb.setTaskModelConfig(image.id)).toEqual({
      status: "not_found",
    });
    await modelConfigDb.updateModelConfig(image.id, {
      ...input,
      enabled: false,
    });
    expect(modelConfigDb.getImageModelConfig()).toBeNull();
    await modelConfigDb.updateModelConfig(image.id, input);
    await modelConfigDb.deleteModelConfig(image.id);
    expect(modelConfigDb.getImageModelConfig()).toBeNull();
  });

  it("does not disable the active image on a failed update and rolls back a failed insert", async () => {
    const image = await modelConfigDb.createModelConfig(input);
    expect(await modelConfigDb.updateModelConfig("missing", input)).toBeNull();
    await expect(
      modelConfigDb.createModelConfig({
        ...input,
        label: null as unknown as string,
      }),
    ).rejects.toThrow();
    expect(modelConfigDb.getImageModelConfig()?.id).toBe(image.id);
  });

  it("clears a task assignment when a chat model becomes an image model", async () => {
    modelConfigDb.setTaskModelConfig("chat-model");
    await modelConfigDb.updateModelConfig("chat-model", input);
    expect(modelConfigDb.getTaskModelConfig()).toBeNull();
    expect(modelConfigDb.getImageModelConfig()?.id).toBe("chat-model");
  });
});

describe("per-user credentials", () => {
  beforeEach(() => {
    raw.exec(`
      DELETE FROM model_config_user_credentials;
      DELETE FROM user;
      INSERT INTO user (id) VALUES ('alice'), ('bob');
      UPDATE model_configs
        SET credential_scope = 'user', api_key = 'model-own-key'
        WHERE id = 'chat-model';
    `);
  });

  it("runs a per-user model only on that user's own credential", async () => {
    const row = (await modelConfigDb.getModelConfig("chat-model"))!;
    expect(modelConfigDb.modelConfigForUser(row, "alice")).toBeNull();

    modelConfigDb.setModelUserCredential("chat-model", "alice", {
      apiKey: "alice-key",
      baseUrl: null,
    });
    modelConfigDb.setModelUserCredential("chat-model", "bob", {
      apiKey: "bob-key",
      baseUrl: "https://bob.test/v1",
    });

    expect(modelConfigDb.modelConfigForUser(row, "alice")).toMatchObject({
      apiKey: "alice-key",
      baseUrl: "https://example.test/v1",
    });
    expect(modelConfigDb.modelConfigForUser(row, "bob")).toMatchObject({
      apiKey: "bob-key",
      baseUrl: "https://bob.test/v1",
    });
    // A credential with no key never falls back to the model's own key.
    modelConfigDb.setModelUserCredential("chat-model", "alice", {
      apiKey: null,
      baseUrl: null,
    });
    expect(modelConfigDb.modelConfigForUser(row, "alice")?.apiKey).toBeNull();
  });

  it("leaves shared models unchanged for everyone", async () => {
    const row = (await modelConfigDb.getModelConfig("hidden-model"))!;
    expect(row.credentialScope).toBe("shared");
    expect(modelConfigDb.modelConfigForUser(row, "alice")).toBe(row);
  });

  it("keeps the stored key when a write omits it, and clears it on null", () => {
    modelConfigDb.setModelUserCredential("chat-model", "alice", {
      apiKey: "alice-key",
      baseUrl: null,
    });
    modelConfigDb.setModelUserCredential("chat-model", "alice", {
      apiKey: undefined, // omitted: keep the stored key
      baseUrl: "https://alice.test/v1",
    });
    expect(modelConfigDb.getModelUserCredential("chat-model", "alice")).toMatchObject({
      apiKey: "alice-key",
      baseUrl: "https://alice.test/v1",
    });
    expect(modelConfigDb.listModelUserCredentials("chat-model")).toEqual([
      expect.objectContaining({
        userId: "alice",
        hasApiKey: true,
        baseUrl: "https://alice.test/v1",
      }),
    ]);
    expect(
      JSON.stringify(modelConfigDb.listModelUserCredentials("chat-model")),
    ).not.toContain("alice-key");
    modelConfigDb.setModelUserCredential("chat-model", "alice", {
      apiKey: null,
      baseUrl: null,
    });
    expect(modelConfigDb.getModelUserCredential("chat-model", "alice")?.apiKey).toBeNull();
  });

  it("lists, deletes, and cascades credentials with their user and model", () => {
    modelConfigDb.setModelUserCredential("chat-model", "alice", { apiKey: "a", baseUrl: null });
    modelConfigDb.setModelUserCredential("chat-model", "bob", { apiKey: "b", baseUrl: null });
    expect([...modelConfigDb.listCredentialedModelIds("alice")]).toEqual(["chat-model"]);
    expect(modelConfigDb.deleteModelUserCredential("chat-model", "alice")).toBe(true);
    expect(modelConfigDb.deleteModelUserCredential("chat-model", "alice")).toBe(false);
    expect(modelConfigDb.listCredentialedModelIds("alice").size).toBe(0);

    raw.pragma("foreign_keys = ON");
    raw.exec("DELETE FROM user WHERE id = 'bob'");
    expect(modelConfigDb.getModelUserCredential("chat-model", "bob")).toBeNull();
  });

  it("never makes a per-user model the task model", async () => {
    expect(modelConfigDb.setTaskModelConfig("chat-model")).toEqual({ status: "per_user" });
    expect(modelConfigDb.getTaskModelConfig()).toBeNull();

    raw.exec("UPDATE model_configs SET credential_scope = 'shared' WHERE id = 'chat-model'");
    expect(modelConfigDb.setTaskModelConfig("chat-model").status).toBe("updated");
    const input = ModelConfigSchema.parse({
      label: "Chat model",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "https://example.test/v1",
      model: "chat",
      credentialScope: "user",
    });
    expect((await modelConfigDb.updateModelConfig("chat-model", input))?.taskModel).toBe(false);
    expect(modelConfigDb.getTaskModelConfig()).toBeNull();
  });
});

describe("credential scope validation", () => {
  const base = {
    label: "Model",
    providerId: "openai",
    apiFormat: "auto",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt",
  };

  it("lets a per-user model omit its own key, but not a shared one", () => {
    expect(ModelConfigSchema.safeParse({ ...base, credentialScope: "user" }).success).toBe(true);
    expect(ModelConfigSchema.safeParse({ ...base, credentialScope: "shared" }).success).toBe(false);
  });

  it("keeps image models shared", () => {
    const result = ModelConfigSchema.safeParse({
      ...base,
      apiKey: "k",
      modelType: "image",
      credentialScope: "user",
    });
    expect(result.success).toBe(false);
  });

  it("leaves an omitted scope undefined so updates keep the stored one", () => {
    const parsed = ModelConfigSchema.parse({ ...base, apiKey: "k" });
    expect(parsed.credentialScope).toBeUndefined();
  });
});
