import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

const svg =
  '<svg viewBox="0 0 240 120"><rect width="240" height="120" fill="teal"/><text x="20" y="65" fill="white">Hello SVG</text></svg>';
const html =
  '<!doctype html><html><head><style>body { background: rgb(240, 250, 255); }</style></head><body><h1>Counter</h1><button onclick="this.textContent = Number(this.textContent) + 1">0</button></body></html>';
const fence = (language: string, source: string) =>
  `\`\`\`${language}\n${source}\n\`\`\``;

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  await page.goto("/signup");
  await page.locator("#name").fill("Preview Tester");
  await page.locator("#email").fill("previews@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
});

function seedMessage(text: string) {
  const db = openE2eDatabase();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as {
      id: string;
    };
    db.prepare(
      "INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES ('preview-chat', ?, 'Previews', 1, 1)",
    ).run(user.id);
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES ('preview-message', 'preview-chat', 'assistant', ?, 1)",
    ).run(JSON.stringify([{ type: "text", text }]));
  } finally {
    db.close();
  }
}

test("renders SVG with source, zoom, fullscreen, download, and reload", async ({
  page,
}) => {
  seedMessage(fence("svg", svg));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/preview-chat");
  const image = page.getByRole("img", { name: "Generated SVG" });
  await expect(image).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const transform = await image.getAttribute("style");
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.locator("pre")).toContainText("Hello SVG");
  await page.getByRole("button", { name: "Show SVG", exact: true }).click();
  await expect(image).toHaveAttribute("style", transform!);
  await page.getByRole("button", { name: "View SVG fullscreen" }).click();
  await expect(
    page.getByRole("dialog").getByRole("img", { name: "Generated SVG" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "View SVG fullscreen" }),
  ).toBeFocused();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("preview.svg");
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe(`${svg}\n`);
  await page.reload();
  await expect(image).toBeVisible();
});

test("opens interactive HTML only on click and stops it on close", async ({
  page,
}) => {
  seedMessage(fence("html", html));
  await page.goto("/chat/preview-chat");
  await expect(page.locator("pre")).toContainText("Counter");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Preview HTML" }).click();
  const preview = page.frameLocator('iframe[title="HTML preview"]');
  await expect(preview.getByRole("heading", { name: "Counter" })).toBeVisible();
  await expect(preview.locator("body")).toHaveCSS(
    "background-color",
    "rgb(240, 250, 255)",
  );
  await preview.getByRole("button", { name: "0", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview HTML" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Preview HTML" }).click();
  await expect(
    preview.getByRole("button", { name: "0", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download HTML", exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("preview.html");
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe(`${html}\n`);
  await page.reload();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Preview HTML" }).click();
  await expect(preview.getByRole("heading", { name: "Counter" })).toBeVisible();
});

test("isolates HTML from the app and blocks fetched resources and API requests", async ({
  page,
  baseURL,
}) => {
  const requests: string[] = [];
  await page.route("**/preview-probe/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ body: "unexpected request" });
  });
  seedMessage(
    fence(
      "html",
      `
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline'">
    <style>@import url('${baseURL}/preview-probe/style'); body { color: rgb(1, 2, 3); }</style>
    <img src="${baseURL}/preview-probe/image">
    <script src="${baseURL}/preview-probe/script"></script>
    <pre id="result"></pre>
    <script>
      (async () => {
        const result = {};
        for (const [name, read] of Object.entries({
          parent: () => parent.document.body,
          cookies: () => document.cookie,
          storage: () => localStorage.getItem('session'),
          top: () => { top.location.href = '${baseURL}/preview-probe/navigation'; }
        })) {
          try { read(); result[name] = 'allowed'; } catch { result[name] = 'blocked'; }
        }
        try { await fetch('${baseURL}/preview-probe/fetch'); result.fetch = 'allowed'; }
        catch { result.fetch = 'blocked'; }
        document.getElementById('result').textContent = JSON.stringify(result);
      })();
    </script>
  `,
    ),
  );
  await page.goto("/chat/preview-chat");
  await page.getByRole("button", { name: "Preview HTML" }).click();
  const frame = page.frameLocator('iframe[title="HTML preview"]');
  await expect(frame.locator("#result")).toHaveText(
    JSON.stringify({
      parent: "blocked",
      cookies: "blocked",
      storage: "blocked",
      top: "blocked",
      fetch: "blocked",
    }),
  );
  await expect(frame.locator("body")).toHaveCSS("color", "rgb(1, 2, 3)");
  expect(requests).toEqual([]);
  await expect(page).toHaveURL(/\/chat\/preview-chat$/);
});

test("SVG images do not execute scripts or load external resources", async ({
  page,
  baseURL,
}) => {
  const requests: string[] = [];
  await page.route("**/preview-probe/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ body: "unexpected request" });
  });
  seedMessage(
    fence(
      "svg",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" onload="parent.document.body.dataset.svgExecuted = 'yes'">
    <script>parent.document.body.dataset.svgExecuted = 'yes';</script>
    <image href="${baseURL}/preview-probe/image" width="100" height="100"/>
    <rect width="240" height="120" fill="teal"/>
  </svg>`,
    ),
  );
  await page.goto("/chat/preview-chat");
  await expect(page.getByRole("img", { name: "Generated SVG" })).toBeVisible();
  expect(
    await page.locator("body").getAttribute("data-svg-executed"),
  ).toBeNull();
  expect(requests).toEqual([]);
});

test("keeps invalid SVG and ordinary code accessible", async ({ page }) => {
  seedMessage(
    [
      fence("svg", "<svg><rect></svg>"),
      fence("ts", "const answer = 42;"),
      "Still readable.",
    ].join("\n\n"),
  );
  await page.goto("/chat/preview-chat");
  await expect(page.getByRole("status")).toContainText(
    "This SVG could not be rendered",
  );
  await expect(
    page.locator("pre").filter({ hasText: "<svg><rect></svg>" }),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-streamdown=code-block]")
      .filter({ hasText: "const answer = 42;" }),
  ).toBeVisible();
  await expect(page.getByText("Still readable.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View SVG fullscreen" }),
  ).toBeDisabled();
});

test("renders SVG progressively while keeping HTML gated on completion", async ({
  page,
  baseURL,
}) => {
  const requests: string[] = [];
  await page.route("**/preview-probe/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ body: "unexpected request" });
  });
  let startSvg = () => {};
  let extendSvg = () => {};
  let finishSvg = () => {};
  let finishHtml = () => {};
  const svgStarted = new Promise<void>((resolve) => {
    startSvg = resolve;
  });
  const svgExtended = new Promise<void>((resolve) => {
    extendSvg = resolve;
  });
  const svgReady = new Promise<void>((resolve) => {
    finishSvg = resolve;
  });
  const htmlReady = new Promise<void>((resolve) => {
    finishHtml = resolve;
  });
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    if (!body || !JSON.parse(body).stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "preview-test" }],
          choices: [
            {
              message: { role: "assistant", content: "Previews" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = (content: string, finishReason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: "preview-stream", object: "chat.completion.chunk", created: 1, model: "preview-test", choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] })}\n\n`,
      );
    delta("```svg\n<sv");
    await svgStarted;
    delta(`g viewBox="0 0 240 120"><g><rect width="240" height="120" fill="teal"/>
      <script>parent.document.body.dataset.svgExecuted = 'yes';</script>
      <image href="${baseURL}/preview-probe/stream" width="20" height="20"/>
      <path d="M`);
    await svgExtended;
    delta(' 10 10 L 40 40" stroke="white"/>');
    await svgReady;
    delta("</g></svg>\n```\n\n```html\n<h1>Streamed");
    await htmlReady;
    delta(" page</h1>\n```\n");
    delta("", "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  try {
    seedMessage("Ready for previews.");
    const db = openE2eDatabase();
    try {
      db.prepare(
        `INSERT INTO model_configs (id, label, provider_id, api_format, base_url, api_key, model, enabled, sort_order, created_at, updated_at) VALUES ('preview-model', 'Preview Model', 'custom', 'openai-chat', ?, 'test-key', 'preview-test', 1, 0, 1, 1)`,
      ).run(`http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`);
    } finally {
      db.close();
    }
    await page.goto("/chat/preview-chat");
    await page
      .getByPlaceholder("Message…")
      .fill("Draw an SVG and an HTML page.");
    await page.getByLabel("Send message").click();
    await expect(page.locator('[data-code-preview="svg"]')).toBeVisible();
    await expect(page.getByRole("img", { name: "Generated SVG" })).toHaveCount(
      0,
    );
    startSvg();
    const image = page.getByRole("img", { name: "Generated SVG" });
    await expect(image).toBeVisible();
    const source = () =>
      image
        .first()
        .evaluate((element) =>
          fetch((element as HTMLImageElement).src).then((response) =>
            response.text(),
          ),
        );
    await expect.poll(source).toContain("<rect");
    expect(await source()).not.toContain("<path");
    await expect(
      page.locator('[data-code-preview="svg"] [role="status"]'),
    ).toHaveCount(0);
    expect(
      await page.locator("body").getAttribute("data-svg-executed"),
    ).toBeNull();
    expect(requests).toEqual([]);
    await page.getByRole("button", { name: "View SVG fullscreen" }).click();
    const expanded = page
      .getByRole("dialog")
      .getByRole("img", { name: "Generated SVG" });
    await expect(expanded).toBeVisible();
    extendSvg();
    await expect
      .poll(() =>
        expanded.evaluate((element) =>
          fetch((element as HTMLImageElement).src).then((response) =>
            response.text(),
          ),
        ),
      )
      .toContain('d="M 10 10 L 40 40"');
    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(expanded).toHaveCount(0);
    finishSvg();
    await expect(image).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preview HTML" }),
    ).toBeDisabled();
    await expect(page.locator("iframe")).toHaveCount(0);
    finishHtml();
    await expect(
      page.getByRole("button", { name: "Preview HTML" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Preview HTML" }).click();
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: "Streamed page" }),
    ).toBeVisible();
  } finally {
    startSvg();
    extendSvg();
    finishSvg();
    finishHtml();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
