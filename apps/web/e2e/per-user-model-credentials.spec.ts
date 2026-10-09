import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

let modelServer: Server;
let modelOrigin: string;
const calls: { path: string; authorization: string | undefined }[] = [];

test.beforeAll(async () => {
  modelServer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      stream?: boolean;
    };
    calls.push({ path: req.url ?? "", authorization: req.headers.authorization });
    const created = Math.floor(Date.now() / 1_000);
    if (!request.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created,
          model: "personal-model",
          choices: [
            { index: 0, message: { role: "assistant", content: "Personal chat" }, finish_reason: "stop" },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    for (const event of [
      { id: "c", object: "chat.completion.chunk", created, model: "personal-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "Answered on your own account" }, finish_reason: null }] },
      { id: "c", object: "chat.completion.chunk", created, model: "personal-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  modelOrigin = `http://127.0.0.1:${(modelServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    modelServer.close((error) => (error ? reject(error) : resolve())),
  );
});

function seedPerUserModel() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, credential_scope, sort_order, created_at, updated_at
      ) VALUES ('personal-model', 'Personal Model', 'custom', 'openai-chat', ?, NULL,
        'personal-model', 0, 1, 'user', 0, ?, ?)`,
    ).run(`${modelOrigin}/shared/v1`, now, now);
  } finally {
    db.close();
  }
}

test("a per-user model runs only for people with their own credential, on that credential", async ({
  browser,
  page,
}, testInfo) => {
  calls.length = 0;
  await page.goto("/signup");
  await page.locator("#name").fill("Credential Admin");
  await page.locator("#email").fill("credential-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  seedPerUserModel();
  const created = await page.request.post("/api/auth/admin/create-user", {
    headers: { Origin: String(testInfo.project.use.baseURL) },
    data: {
      email: "credential-member@overtchat-test.local",
      name: "Credential Member",
      password: "test-password-123",
      role: "user",
    },
  });
  expect(created.status(), await created.text()).toBe(200);

  const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const member = await memberContext.newPage();
    await member.goto("/login");
    await member.getByLabel("Email").fill("credential-member@overtchat-test.local");
    await member.locator("#password").fill("test-password-123");
    await member.getByRole("button", { name: "Sign in" }).click();
    await member.waitForURL("**/");

    const visibleTo = async (p: typeof page) =>
      ((await (await p.request.get("/api/model-configs")).json()) as {
        modelConfigs: { id: string }[];
      }).modelConfigs.map((m) => m.id);
    // Nobody has a credential yet: hidden from everyone, the administrator included.
    expect(await visibleTo(member)).toEqual([]);
    expect(await visibleTo(page)).toEqual([]);

    await page.goto("/settings/models/personal-model");
    await expect(page.getByRole("combobox", { name: "Credentials" })).toContainText(
      "Each person's own",
    );
    const people = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "People", exact: true }) });
    await people.getByRole("button", { name: "Set up credential for Credential Member" }).click();
    await people.getByLabel("API key for Credential Member").fill("member-key");
    await people.getByLabel("Endpoint for Credential Member").fill(`${modelOrigin}/member/v1`);
    // Enter saves this person's credential (its own form), not the surrounding model.
    await people.getByLabel("Endpoint for Credential Member").press("Enter");
    await expect(people).toContainText(`Key set · own endpoint ${modelOrigin}/member/v1`);
    await expect(page).toHaveURL(/\/settings\/models\/personal-model$/);
    // Changing the key keeps the saved endpoint, even when the saved credentials load after the
    // people list (the rows first render without them).
    await page.route("**/api/model-configs/personal-model/credentials", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.reload();
    await expect(people).toContainText("Loading people");
    await expect(
      people.getByRole("button", { name: /credential for Credential Member/ }),
    ).toHaveCount(0);
    await expect(people).toContainText("Credential Member");
    await expect(people).toContainText(`Key set · own endpoint ${modelOrigin}/member/v1`);
    await page.unroute("**/api/model-configs/personal-model/credentials");
    await people.getByRole("button", { name: "Change credential for Credential Member" }).click();
    await expect(people.getByLabel("Endpoint for Credential Member")).toHaveValue(`${modelOrigin}/member/v1`);
    await people.getByLabel("API key for Credential Member").fill("member-key");
    await people.getByRole("button", { name: "Save credential for Credential Member" }).click();
    await expect(people).toContainText(`Key set · own endpoint ${modelOrigin}/member/v1`);
    // The key itself is never sent back to the browser.
    const listed = await page.request.get("/api/model-configs/personal-model/credentials");
    expect(await listed.text()).not.toContain("member-key");

    // A per-user model needs no key of its own, even for a provider that requires one: the
    // editor saves it (no browser "required" block).
    const db = openE2eDatabase();
    try {
      db.prepare("UPDATE model_configs SET provider_id = 'openai', api_format = 'auto' WHERE id = 'personal-model'").run();
    } finally {
      db.close();
    }
    await page.reload();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL("**/settings/models", { timeout: 15_000 });
    {
      const db2 = openE2eDatabase();
      try {
        db2.prepare("UPDATE model_configs SET provider_id = 'custom', api_format = 'openai-chat' WHERE id = 'personal-model'").run();
      } finally {
        db2.close();
      }
    }

    expect(await visibleTo(member)).toEqual(["personal-model"]);
    expect(await visibleTo(page)).toEqual([]);

    await member.reload();
    await member.getByPlaceholder("Message…").fill("Hello on my own account");
    await member.getByLabel("Send message").click();
    await expect(member.getByText("Answered on your own account")).toBeVisible();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toEqual({ path: "/member/v1/chat/completions", authorization: "Bearer member-key" });
    }
  } finally {
    await memberContext.close();
  }
});
