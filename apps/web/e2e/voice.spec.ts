import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

function seedVoiceFixtures() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (!user) throw new Error("Expected the signed-in E2E user");

    db.prepare(
      `INSERT INTO model_configs
        (id, label, base_url, api_key, model, system_prompt, provider_options, enabled, sort_order, created_at, updated_at)
       VALUES
        ('voice-model', 'Voice Test Model', 'https://example.invalid/v1', 'test-key',
         'voice-test-model', NULL, NULL, 1, 0, @now, @now)`,
    ).run({ now });
    db.prepare(
      `INSERT INTO chats
        (id, user_id, title, kind, created_at, updated_at)
       VALUES
        ('voice-chat', @userId, 'Voice Topic', 'voice', @now, @now),
        ('text-chat', @userId, 'Text Topic', 'text', @now, @now - 1)`,
    ).run({ userId: user.id, now });
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, created_at)
       VALUES
        ('voice-user', 'voice-chat', 'user', @voiceParts, @now),
        ('text-user', 'text-chat', 'user', @textParts, @now)`,
    ).run({
      voiceParts: JSON.stringify([{ type: "text", text: "Hello by voice" }]),
      textParts: JSON.stringify([{ type: "text", text: "Hello by text" }]),
      now,
    });
  } finally {
    db.close();
  }
}

test.beforeEach(resetE2eDatabase);

test("voice toggles within ordinary and legacy voice chats", async ({
  page,
}) => {
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>(resolve => { releaseSession = resolve; });
  await page.route("**/api/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        capabilities: {
          search: { provider: "disabled" },
          stt: { provider: "parakeet" },
          tts: { provider: "kokoro" },
          voice: { available: true, installed: true, unavailableReason: null },
        },
      }),
    });
  });
  await page.route("**/api/voice/session", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    await sessionGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "test-ticket",
        sessionId: "test-session",
        chatId: "new-voice-chat",
        endpoint: "/api/voice/realtime",
        voice: "af_heart",
      }),
    });
  });

  await page.route("**/api/voice/events", route => route.fulfill({
    status: 503, body: "Unavailable",
  }));

  await page.goto(await setupUrl());
  await page.locator("#name").fill("Voice Admin");
  await page.locator("#email").fill("voice-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  seedVoiceFixtures();
  await page.reload();

  const composer = page.getByPlaceholder("Message… or / for commands");
  await expect(
    page.getByRole("button", { name: "Start voice conversation" }),
  ).toBeVisible();
  await composer.fill("typed message");
  await expect(
    page.getByRole("button", { name: "Start voice conversation" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await composer.fill("");
  await expect(page.getByRole("button", { name: "Enable temporary chat" })).toBeVisible();
  await page.getByRole("button", { name: "Start voice conversation" }).click();
  await expect(page.getByText("Connecting", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable temporary chat" })).toHaveCount(0);
  await composer.fill("Keep this draft during startup");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(composer).toHaveValue("Keep this draft during startup");
  await composer.fill("/temporary");
  await expect(page.getByRole("option", { name: /temporary/i })).toHaveCount(0);
  await composer.fill("/search");
  await expect(page.getByText("End voice to require a web search. Voice can still search automatically.", { exact: true })).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("/search");
  await composer.fill("Keep this draft after startup failure");
  releaseSession();
  await expect(page.getByText("Could not connect voice history.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(composer).toHaveValue("Keep this draft after startup failure");
  await expect(composer).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop assistant" })).toHaveCount(0);
  await page.getByRole("button", { name: "End voice session" }).click();
  await expect(composer).toHaveValue("Keep this draft after startup failure");
  await expect(page.getByRole("button", { name: "Enable temporary chat" })).toBeVisible();
  await composer.fill("/search");
  await expect(page.getByText("End voice to require a web search. Voice can still search automatically.", { exact: true })).toHaveCount(0);
  await composer.fill("");

  const voiceRow = page.getByRole("listitem").filter({ hasText: "Voice Topic" });
  await expect(voiceRow.getByLabel("Voice chat")).toHaveCount(0);
  await voiceRow.hover();
  const chatActions = voiceRow.getByRole("button", { name: "Chat actions" });
  await expect(chatActions).toBeVisible();

  await page.goto("/chat/text-chat");
  await expect(
    page.getByRole("button", { name: "Start voice conversation" }),
  ).toBeVisible();

  await page.goto("/chat/voice-chat");
  await expect(composer).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Start voice conversation" }),
  ).toBeVisible();
  await expect(page.getByText("Hello by voice")).toBeVisible();

  await page.route("**/api/server-capabilities", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), voice: {
      available: false, installed: false, unavailableReason: "not-installed",
    } } });
  });
  await page.goto("/settings/services");
  await expect(
    page.getByRole("heading", { name: "Realtime voice" }),
  ).toBeVisible();
  await expect(page.getByText("Not installed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Run overtchat setup and enable realtime voice/),
  ).toBeVisible();
});
