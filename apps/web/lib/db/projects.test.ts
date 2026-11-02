import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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
const { getProject, toProjectListItem, updateProject } = await import(
  "./projects"
);

beforeEach(() => {
  raw.exec(`DELETE FROM projects; DELETE FROM user; DELETE FROM model_configs;
    INSERT INTO user (id, name, email) VALUES ('a', 'A', 'a@example.test'), ('b', 'B', 'b@example.test');
    INSERT INTO projects (id, user_id, name) VALUES ('p', 'a', 'Project');
    INSERT INTO model_configs (id, label, base_url, model, enabled, model_type) VALUES
      ('one', 'One', 'https://example.test', 'one', 1, 'chat'),
      ('hidden', 'Hidden', 'https://example.test', 'hidden', 0, 'chat'),
      ('image', 'Image', 'https://example.test', 'image', 1, 'image');`);
});

it("sets, reports, and clears a project's default model", async () => {
  const updated = await updateProject("p", "a", { defaultModelId: "one" });
  if (!updated || updated === "model-unavailable") throw new Error("not updated");
  expect(toProjectListItem(updated).defaultModelId).toBe("one");

  await updateProject("p", "a", { name: "Renamed" });
  expect((await getProject("p", "a"))?.defaultModelConfigId).toBe("one");

  await updateProject("p", "a", { defaultModelId: null });
  expect((await getProject("p", "a"))?.defaultModelConfigId).toBeNull();
});

it("rejects models that cannot start a chat without changing the project", async () => {
  await updateProject("p", "a", { defaultModelId: "one" });
  for (const id of ["hidden", "image", "missing"]) {
    await expect(
      updateProject("p", "a", { name: "Changed", defaultModelId: id }),
    ).resolves.toBe("model-unavailable");
  }
  const project = await getProject("p", "a");
  expect(project?.name).toBe("Project");
  expect(project?.defaultModelConfigId).toBe("one");
});

it("only updates the owner's project", async () => {
  await expect(
    updateProject("p", "b", { defaultModelId: "one" }),
  ).resolves.toBeNull();
  expect((await getProject("p", "a"))?.defaultModelConfigId).toBeNull();
});

it("clears the default when its model is deleted", async () => {
  await updateProject("p", "a", { defaultModelId: "one" });
  raw.exec("DELETE FROM model_configs WHERE id = 'one'");
  const project = await getProject("p", "a");
  expect(project?.name).toBe("Project");
  expect(project?.defaultModelConfigId).toBeNull();
});
