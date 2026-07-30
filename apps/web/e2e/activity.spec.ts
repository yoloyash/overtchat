import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

let modelServer: Server;
let modelBaseUrl: string;

test.beforeAll(async () => {
  modelServer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      stream?: boolean;
    };
    const created = Math.floor(Date.now() / 1_000);

    if (!request.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "title-response",
          object: "chat.completion",
          created,
          model: "activity-test-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Tracked chat" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
          },
        }),
      );
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const events = [
      {
        id: "chat-response",
        object: "chat.completion.chunk",
        created,
        model: "activity-test-model",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Tracked response" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chat-response",
        object: "chat.completion.chunk",
        created,
        model: "activity-test-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
      {
        id: "chat-response",
        object: "chat.completion.chunk",
        created,
        model: "activity-test-model",
        choices: [],
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 200,
          total_tokens: 1_200,
          prompt_tokens_details: { cached_tokens: 600 },
        },
      },
    ];
    for (const event of events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => {
    modelServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = modelServer.address() as AddressInfo;
  modelBaseUrl = `http://127.0.0.1:${port}/v1`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    modelServer.close((error) => (error ? reject(error) : resolve()));
  });
});

function seedFamilyData() {
  const db = openE2eDatabase();
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO model_configs (
        id, label, provider_id, api_format, base_url, api_key, model,
        tool_calling_enabled, enabled, sort_order, created_at, updated_at
      ) VALUES (?, ?, 'custom', 'openai-chat', ?, 'test-key', ?, 1, 1, 0, ?, ?)`,
    ).run(
      "activity-model",
      "Activity Test Model",
      modelBaseUrl,
      "activity-test-model",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO user (
        id, name, email, email_verified, created_at, updated_at, role, banned
      ) VALUES (?, ?, ?, 1, ?, ?, 'user', 0)`,
    ).run(
      "activity-family-member",
      "Taylor",
      "taylor@overtchat-test.local",
      now,
      now,
    );

    const insert = db.prepare(
      `INSERT INTO generation_usage (
        id, user_id, occurred_at, provider_id, model, input_tokens,
        uncached_input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, total_tokens, finish_reason
      ) VALUES (
        @id, @userId, @occurredAt, @providerId, @model, @inputTokens,
        @uncachedInputTokens, @outputTokens, @cacheReadTokens,
        @cacheWriteTokens, @totalTokens, 'stop'
      )`,
    );
    insert.run({
      id: "taylor-recent",
      userId: "activity-family-member",
      occurredAt: now - 120_000,
      providerId: "openai",
      model: "gpt-family",
      inputTokens: 400,
      uncachedInputTokens: 400,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 500,
    });
    insert.run({
      id: "taylor-older",
      userId: "activity-family-member",
      occurredAt: now - 10 * 24 * 60 * 60 * 1_000,
      providerId: "openai",
      model: "gpt-family",
      inputTokens: 900,
      uncachedInputTokens: 900,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1_000,
    });
  } finally {
    db.close();
  }
}

function trackedUsageCount(): number {
  const db = openE2eDatabase();
  try {
    return (
      db
        .prepare("SELECT count(*) AS count FROM generation_usage")
        .get() as { count: number }
    ).count;
  } finally {
    db.close();
  }
}

test("family leaderboard and person activity profile are verifiable", async ({
  page,
}) => {
  await test.step("create the family admin and stream tracked usage", async () => {
    await page.goto("/signup");
    await page.locator("#name").fill("Activity Admin");
    await page
      .locator("#email")
      .fill("activity-admin@overtchat-test.local");
    await page.locator("#password").fill("test-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/", { timeout: 15_000 });
    seedFamilyData();
    await page.reload();

    const composer = page.getByPlaceholder("Message…");
    await composer.fill("Record this response.");
    await page.getByLabel("Send message").click();
    await expect(page.getByText("Tracked response")).toBeVisible();
    await expect.poll(trackedUsageCount).toBe(3);
  });

  await test.step("compare the 30-day and 7-day rankings", async () => {
    await page.goto("/activity");
    await expect(
      page.getByRole("heading", { name: "Family leaderboard" }),
    ).toBeVisible();
    const people = page.locator('a[href^="/activity/"]');
    await expect(people.nth(0)).toContainText("Taylor");
    await expect(people.nth(0)).toContainText("1.5K");
    await expect(people.nth(1)).toContainText("Activity Admin");

    await page.getByRole("button", { name: "7 days" }).click();
    await expect(people.nth(0)).toContainText("Activity Admin");
    await expect(people.nth(1)).toContainText("Taylor");
  });

  await test.step("open a person profile with heatmap and models", async () => {
    await page.getByRole("link", { name: /Taylor/ }).click();
    await page.waitForURL("**/activity/activity-family-member");
    await expect(
      page.getByRole("heading", { name: "Taylor" }),
    ).toBeVisible();
    await expect(page.getByText("gpt-family")).toBeVisible();
    await expect(
      page.getByRole("gridcell", { name: /500 chat tokens/ }),
    ).toBeVisible();
    await expect(page.getByText("1.5K").first()).toBeVisible();
  });

  await test.step("remain usable without page overflow on mobile", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/activity");
    await expect(
      page.getByRole("heading", { name: "Family leaderboard" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.goto("/activity/activity-family-member");
    await expect(
      page.getByRole("heading", { name: "Taylor" }),
    ).toBeVisible();
    const heatmapScroller = page.getByRole("grid").locator("..");
    await expect
      .poll(() => heatmapScroller.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("gridcell", { name: /500 chat tokens/ }),
    ).toBeVisible();
  });
});
