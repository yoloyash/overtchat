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
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as {
      id: string;
    };
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

test("renders diagrams and updates their theme without reloading", async ({
  page,
}) => {
  seedMessage(
    '```mermaid\ngraph TD\n  A["Start<br/>Browser"] --> B["Finish<br/>Server"]\n```',
  );
  await page.goto("/chat/mermaid-chat");

  const diagram = page.getByRole("img", { name: "Mermaid chart" });
  await expect(diagram).toBeVisible();
  await expect
    .poll(() =>
      diagram.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const fill = () =>
    diagram.evaluate(async (element) => {
      const markup = await fetch((element as HTMLImageElement).src).then(
        (response) => response.text(),
      );
      const svg = new DOMParser().parseFromString(
        markup,
        "image/svg+xml",
      ).documentElement;
      document.body.append(svg);
      try {
        return getComputedStyle(svg.querySelector(".node rect")!).fill;
      } finally {
        svg.remove();
      }
    });
  const lightFill = await fill();

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(fill).not.toBe(lightFill);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(fill).toBe(lightFill);

  await page.getByRole("button", { name: "View fullscreen" }).click();
  await expect(
    page.getByRole("button", { name: "Exit fullscreen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("img", { name: "Mermaid chart" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(diagram).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "View fullscreen" }),
  ).toBeFocused();
});

test("keeps invalid diagram source accessible and ordinary code highlighted", async ({
  page,
}) => {
  seedMessage(
    [
      "```mermaid",
      "not-a-diagram",
      "```",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "The rest of the message still renders.",
    ].join("\n"),
  );
  await page.goto("/chat/mermaid-chat");

  await expect(page.getByText(/Mermaid Error:/)).toBeVisible();
  await page.getByText("Show Code", { exact: true }).click();
  await expect(
    page.locator("pre").filter({ hasText: "not-a-diagram" }),
  ).toBeVisible();
  await expect(page.locator("[data-streamdown=code-block]")).toContainText(
    "const answer = 42;",
  );
  await expect(
    page.getByText("The rest of the message still renders."),
  ).toBeVisible();
});

test("renders a diagram when its streamed code fence completes", async ({
  page,
}) => {
  let finishDiagram = () => {};
  const completed = new Promise<void>((resolve) => {
    finishDiagram = resolve;
  });
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    if (!body || !JSON.parse(body).stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "mermaid-test" }],
          choices: [
            {
              message: { role: "assistant", content: "Diagrams" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = (content: string, finishReason: string | null = null) => {
      res.write(
        `data: ${JSON.stringify({
          id: "mermaid-stream",
          object: "chat.completion.chunk",
          created: 1,
          model: "mermaid-test",
          choices: [
            { index: 0, delta: { content }, finish_reason: finishReason },
          ],
        })}\n\n`,
      );
    };
    delta(
      "Here is the diagram.\n\n```mermaid\ngraph TD\n A[Stream start] --> B[",
    );
    await completed;
    delta("Stream finish]\n```\n");
    delta("", "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
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
    await expect(diagram).toBeVisible();
    await expect
      .poll(() =>
        diagram.evaluate(async (element) =>
          fetch((element as HTMLImageElement).src).then((response) =>
            response.text(),
          ),
        ),
      )
      .toContain("Stream finish");
    await expect(page.getByLabel("Send message")).toBeVisible();
  } finally {
    finishDiagram();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      provider.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

for (const direction of ["LR", "TD"]) {
  test(`fits and resizes a ${direction === "LR" ? "wide" : "tall"} diagram`, async ({
    page,
  }) => {
    const edges = Array.from(
      { length: 8 },
      (_, index) =>
        `N${index}[Service ${index}] --> N${index + 1}[Service ${index + 1}]`,
    );
    seedMessage(
      ["```mermaid", `flowchart ${direction}`, ...edges, "```"].join("\n"),
    );
    await page.goto("/chat/mermaid-chat");
    const viewer = page.getByRole("region", {
      name: "Diagram viewer",
      exact: true,
    });
    const image = viewer.getByRole("img");
    await expect(image).toBeVisible();
    const initial = (await viewer.boundingBox())!;
    const drawing = (await image.boundingBox())!;
    expect(drawing.width).toBeLessThanOrEqual(initial.width);
    expect(drawing.height).toBeLessThanOrEqual(initial.height);
    if (direction === "LR")
      expect(drawing.width).toBeGreaterThan(initial.width * 0.9);
    else expect(drawing.height).toBeGreaterThan(initial.height * 0.9);

    const handle = page.getByRole("separator", { name: "Resize diagram" });
    await handle.scrollIntoViewIfNeeded();
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2,
      grip.y + grip.height / 2 + 100,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await viewer.boundingBox())!.height)
      .toBeCloseTo(initial.height + 100, 0);
    if (direction === "TD") {
      await expect
        .poll(async () => (await image.boundingBox())!.height)
        .toBeGreaterThan(drawing.height + 90);
    }
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect
      .poll(async () => (await viewer.boundingBox())!.height)
      .toBeCloseTo(initial.height + 60, 0);

    await page
      .getByRole("button", { name: "Actual size", exact: true })
      .click();
    await expect
      .poll(() => image.evaluate((element) => element.style.transform))
      .toContain("scale(1)");
    const beforePan = await image.getAttribute("style");
    await viewer.scrollIntoViewIfNeeded();
    const area = (await viewer.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, area.y + 70);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width / 2 - 60, area.y + 120, {
      steps: 5,
    });
    await page.mouse.up();
    await expect.poll(() => image.getAttribute("style")).not.toBe(beforePan);

    await page
      .getByRole("button", { name: "Fit diagram", exact: true })
      .click();
    await page.getByRole("button", { name: "View fullscreen" }).click();
    const fullscreen = page.getByRole("region", {
      name: "Fullscreen diagram viewer",
    });
    const expandedImage = fullscreen.getByRole("img");
    await expect(expandedImage).toBeVisible();
    const expanded = (await expandedImage.boundingBox())!;
    const screen = (await fullscreen.boundingBox())!;
    expect(expanded.width).toBeLessThanOrEqual(screen.width);
    expect(expanded.height).toBeLessThanOrEqual(screen.height);
    expect(
      direction === "LR" ? expanded.width : expanded.height,
    ).toBeGreaterThan(direction === "LR" ? drawing.width : drawing.height);
  });
}

test("preserves chat scrolling and uses modifier-wheel zoom inline", async ({
  page,
}) => {
  seedMessage(
    [
      "```mermaid",
      "graph LR",
      "A[Start] --> B[Finish]",
      "```",
      "",
      ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i}.\n`),
    ].join("\n"),
  );
  await page.goto("/chat/mermaid-chat");
  const viewer = page.getByRole("region", {
    name: "Diagram viewer",
    exact: true,
  });
  await viewer.scrollIntoViewIfNeeded();
  const image = viewer.getByRole("img");
  await expect(image).toBeVisible();
  const transform = await image.getAttribute("style");
  const transcript = page.locator("[data-chat-transcript-scroll]");
  const before = await transcript.evaluate((element) => element.scrollTop);
  await viewer.hover();
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => transcript.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before);
  expect(await image.getAttribute("style")).toBe(transform);
  await viewer.scrollIntoViewIfNeeded();
  await viewer.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => image.getAttribute("style")).not.toBe(transform);
});

test("supports pinch zoom in fullscreen on a narrow screen", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  seedMessage(
    "```mermaid\ngraph LR\nA[Browser] --> B[Server] --> C[Model]\n```",
  );
  await page.goto("/chat/mermaid-chat");
  await expect(page.getByRole("img", { name: "Mermaid chart" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "View fullscreen" }).click();
  const viewer = page.getByRole("region", {
    name: "Fullscreen diagram viewer",
  });
  const image = viewer.getByRole("img");
  await expect(image).toBeVisible();
  const initial = (await image.boundingBox())!.width;
  const box = (await viewer.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: x - 30, y },
      { id: 2, x: x + 30, y },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: x - 65, y },
      { id: 2, x: x + 65, y },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(initial * 1.5);
  await session.detach();
});

test("can view source and download the SVG after zooming", async ({ page }) => {
  const source = "graph LR\nA[Browser] --> B[Server]";
  seedMessage(`\`\`\`mermaid\n${source}\n\`\`\``);
  await page.goto("/chat/mermaid-chat");
  const image = page.getByRole("img", { name: "Mermaid chart" });
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const transform = await image.getAttribute("style");
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.locator("pre").filter({ hasText: source })).toBeVisible();
  await page.getByRole("button", { name: "Show diagram", exact: true }).click();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("style", transform!);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagram as SVG" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("diagram.svg");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString();
  expect(svg).toContain("viewBox=");
  expect(svg).toContain("Browser");
  expect(svg).toContain("Server");
});
