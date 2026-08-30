import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

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

test("voice is a distinct resumable chat mode in the regular composer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    });
  });
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
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "test-ticket",
        chatId: "new-voice-chat",
        endpoint: "/api/voice/realtime",
        voice: "af_heart",
        tools: [],
      }),
    });
  });

  await page.goto("/signup");
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
  await page.getByRole("button", { name: "Start voice conversation" }).click();
  await expect(page.getByText(/Microphone access was denied/)).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop assistant" })).toHaveCount(0);
  await page.getByRole("button", { name: "End voice session" }).click();

  const voiceRow = page.getByRole("listitem").filter({ hasText: "Voice Topic" });
  const voiceIndicator = voiceRow.getByLabel("Voice chat");
  await expect(voiceIndicator).toBeVisible();
  const indicatorBounds = await voiceIndicator.boundingBox();
  await voiceRow.hover();
  await expect(voiceIndicator).toBeHidden();
  const chatActions = voiceRow.getByRole("button", { name: "Chat actions" });
  await expect(chatActions).toBeVisible();
  const actionBounds = await chatActions.boundingBox();
  expect(indicatorBounds).not.toBeNull();
  expect(actionBounds).not.toBeNull();
  expect((actionBounds?.x ?? 0) + (actionBounds?.width ?? 0) / 2).toBeCloseTo(
    (indicatorBounds?.x ?? 0) + (indicatorBounds?.width ?? 0) / 2,
    0,
  );
  expect((actionBounds?.y ?? 0) + (actionBounds?.height ?? 0) / 2).toBeCloseTo(
    (indicatorBounds?.y ?? 0) + (indicatorBounds?.height ?? 0) / 2,
    0,
  );

  await page.goto("/chat/text-chat");
  await expect(
    page.getByRole("button", { name: "Start voice conversation" }),
  ).toHaveCount(0);

  await page.goto("/chat/voice-chat");
  await expect(page.getByPlaceholder("Resume voice to continue")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start voice conversation" }),
  ).toBeVisible();
  await expect(page.getByText("Hello by voice")).toBeVisible();
});
