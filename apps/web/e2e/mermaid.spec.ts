import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/signup");
  await page.locator("#name").fill("Diagram Tester");
  await page.locator("#email").fill("diagrams@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
});

function seedMessage(text: string) {
  const db = openE2eDatabase();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('mermaid-chat', ?, 'Diagrams', 1, 1)`,
    ).run(user.id);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, created_at)
       VALUES ('mermaid-message', 'mermaid-chat', 'assistant', ?, 1)`,
    ).run(JSON.stringify([{ type: "text", text }]));
  } finally {
    db.close();
  }
}

test("renders diagrams and updates their theme without reloading", async ({ page }) => {
  seedMessage("```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```");
  await page.goto("/chat/mermaid-chat");

  const diagram = page.getByRole("img", { name: "Mermaid chart" });
  await expect(diagram.locator("svg")).toBeVisible();
  await expect(diagram).toContainText("Start");
  await expect(diagram).toContainText("Finish");
  const node = diagram.locator(".node rect").first();
  const lightFill = await node.evaluate((element) => getComputedStyle(element).fill);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => node.evaluate((element) => getComputedStyle(element).fill))
    .not.toBe(lightFill);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => node.evaluate((element) => getComputedStyle(element).fill))
    .toBe(lightFill);

  await page.getByRole("button", { name: "View fullscreen" }).click();
  await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Mermaid chart" })).toHaveCount(2);
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(diagram).toHaveCount(1);
});

test("keeps invalid diagram source accessible and ordinary code highlighted", async ({ page }) => {
  seedMessage([
    "```mermaid", "not-a-diagram", "```", "",
    "```ts", "const answer = 42;", "```", "",
    "The rest of the message still renders.",
  ].join("\n"));
  await page.goto("/chat/mermaid-chat");

  await expect(page.getByText(/Mermaid Error:/)).toBeVisible();
  await page.getByText("Show Code", { exact: true }).click();
  await expect(page.locator("pre").filter({ hasText: "not-a-diagram" })).toBeVisible();
  await expect(page.locator("[data-streamdown=code-block]")).toContainText("const answer = 42;");
  await expect(page.getByText("The rest of the message still renders.")).toBeVisible();
});

test("renders a diagram when its streamed code fence completes", async ({ page }) => {
  let finishDiagram = () => {};
  const completed = new Promise<void>((resolve) => { finishDiagram = resolve; });
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    if (!body || !JSON.parse(body).stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [{ id: "mermaid-test" }],
        choices: [{ message: { role: "assistant", content: "Diagrams" }, finish_reason: "stop" }],
      }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = (content: string, finishReason: string | null = null) => {
      res.write(`data: ${JSON.stringify({
        id: "mermaid-stream", object: "chat.completion.chunk", created: 1,
        model: "mermaid-test",
        choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
      })}\n\n`);
    };
    delta("Here is the diagram.\n\n```mermaid\ngraph TD\n A[Stream start] --> B[");
    await completed;
    delta("Stream finish]\n```\n");
    delta("", "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  try {
    seedMessage("Ready for a diagram.");
    const db = openE2eDatabase();
    try {
      db.prepare(
        `INSERT INTO model_configs (
          id, label, provider_id, api_format, base_url, api_key, model,
          enabled, sort_order, created_at, updated_at
        ) VALUES ('mermaid-model', 'Diagram Model', 'custom', 'openai-chat',
          ?, 'test-key', 'mermaid-test', 1, 0, 1, 1)`,
      ).run(`http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`);
    } finally {
      db.close();
    }
    await page.goto("/chat/mermaid-chat");
    await page.getByPlaceholder("Message…").fill("Draw a flowchart.");
    await page.getByLabel("Send message").click();
    await expect(page.getByText("Here is the diagram.")).toBeVisible();
    await expect(page.locator("[data-streamdown=mermaid-block]")).toBeVisible();
    await expect(page.getByText(/Mermaid Error:/)).toHaveCount(0);

    finishDiagram();
    const diagram = page.getByRole("img", { name: "Mermaid chart" });
    await expect(diagram.locator("svg")).toBeVisible();
    await expect(diagram).toContainText("Stream finish");
    await expect(page.getByLabel("Send message")).toBeVisible();
  } finally {
    finishDiagram();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      provider.close((error) => error ? reject(error) : resolve());
    });
  }
});
