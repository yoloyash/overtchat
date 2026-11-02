import { expect, test, type Page } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

async function createAccountAndProject(page: Page) {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Project Admin");
  await page.locator("#email").fill("project-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const db = openE2eDatabase();
  const now = Date.now();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as
      { id: string } | undefined;
    if (!user) throw new Error("Signup user was not created");
    db.prepare(
      `INSERT INTO projects (id, user_id, name, instructions, created_at, updated_at)
       VALUES ('home-project', ?, 'Launch plan', 'Answer as a release manager.', ?, ?)`,
    ).run(user.id, now, now);
    const insertModel = db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (?, ?, 'custom', 'openai-chat', 'http://127.0.0.1:1/v1',
        'test-key', ?, 0, 1, ?, ?, ?)`,
    );
    insertModel.run("first-model", "First Model", "first", 0, now, now);
    insertModel.run("project-model", "Project Model", "project", 1, now, now);
    const insertChat = db.prepare(
      `INSERT INTO chats (id, user_id, project_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertChat.run("in-project", user.id, "home-project", "Rollout checklist", now, now);
    insertChat.run("outside", user.id, null, "Unrelated chat", now, now);
  } finally {
    db.close();
  }
}

test("a project's default model starts its new chats and survives model removal", async ({
  page,
}) => {
  await createAccountAndProject(page);
  await page.goto("/projects/home-project");

  await expect(page.getByRole("heading", { name: "Launch plan" })).toBeVisible();
  await expect(page.getByText("Answer as a release manager.")).toBeVisible();
  const chats = page.getByRole("region", { name: "Chats" });
  await expect(chats.getByRole("link", { name: /Rollout checklist/ })).toBeVisible();
  await expect(chats.getByText("Unrelated chat")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "First Model", exact: true }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: "Project Model" }).click();
  await expect(
    page.getByRole("button", { name: "Project Model", exact: true }),
  ).toBeVisible();

  // A fresh visit starts with the saved project default.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Project Model", exact: true }),
  ).toBeVisible();
  // Chats outside the project keep the account default.
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "First Model", exact: true }),
  ).toBeVisible();

  const requests: { modelConfigId: string; projectId: string | null }[] = [];
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.abort();
  });
  await page.goto("/projects/home-project");
  await page.getByPlaceholder("Message…").fill("Draft the announcement");
  await page.getByLabel("Send message").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    modelConfigId: "project-model",
    projectId: "home-project",
  });
  await page.unroute("**/api/chat");

  const rejected = await page.request.patch("/api/projects/home-project", {
    data: { defaultModelId: "missing-model" },
  });
  expect(rejected.status()).toBe(400);

  const db = openE2eDatabase();
  try {
    db.pragma("foreign_keys = ON");
    db.prepare("DELETE FROM model_configs WHERE id = 'project-model'").run();
  } finally {
    db.close();
  }
  await page.goto("/projects/home-project");
  await expect(
    page.getByRole("button", { name: "First Model", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Default model" })).toContainText(
    "Account default",
  );
});

test("project chats link back to their project", async ({ page }) => {
  await createAccountAndProject(page);
  await page.goto("/chat/in-project");
  const crumb = page
    .locator("header[data-titlebar]")
    .getByRole("link", { name: "Launch plan" });
  await expect(crumb).toBeVisible();
  await crumb.click();
  await page.waitForURL("**/projects/home-project");
  await expect(page.getByRole("heading", { name: "Launch plan" })).toBeVisible();
});
