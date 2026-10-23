import { networkInterfaces } from "node:os";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";
import {
  openE2eDatabase,
  resetE2eDatabase,
  setupUrl,
} from "./helpers/database";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
const ui =
  'root = Card([CardHeader("Travel form"), booking])\nbooking = Form("trip", Buttons([Button("Plan trip", @ToAssistant("Plan this trip"))]), [FormControl("Destination", Input("destination", "City"))])';

test.beforeEach(resetE2eDatabase);

async function setup(page: Page) {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Sharing Tester");
  await page.locator("#email").fill("sharing@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const imageResponse = await page.request.post("/api/uploads", {
    multipart: {
      file: {
        name: "photo.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      },
    },
  });
  expect(imageResponse.ok()).toBe(true);
  const image = await imageResponse.json();
  image.id = image.url.split("/").at(-1);
  const documentResponse = await page.request.post("/api/uploads", {
    multipart: {
      file: {
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Shared attachment contents"),
      },
    },
  });
  expect(documentResponse.ok()).toBe(true);
  const document = await documentResponse.json();
  const db = openE2eDatabase();
  try {
    const owner = db.prepare("SELECT id FROM user LIMIT 1").get() as {
      id: string;
    };
    db.prepare(
      "INSERT INTO chats (id, user_id, title) VALUES ('sharing-chat', ?, 'Research reference')",
    ).run(owner.id);
    const insert = db.prepare(
      "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at) VALUES (?, 'sharing-chat', ?, ?, ?, ?)",
    );
    insert.run(
      "question",
      "user",
      JSON.stringify([
        { type: "text", text: "Explain the research" },
        {
          type: "file",
          url: image.url,
          mediaType: "image/png",
          filename: "photo.png",
        },
        {
          type: "file",
          url: document.url,
          mediaType: "text/plain",
          filename: "notes.txt",
        },
      ]),
      null,
      1,
    );
    insert.run(
      "answer",
      "assistant",
      JSON.stringify([
        {
          type: "reasoning",
          text: "Visible reasoning from the conversation",
          state: "done",
          providerMetadata: { secret: "private-provider-data" },
        },
        {
          type: "tool-fetch_url",
          toolCallId: "fetch-image",
          state: "output-available",
          input: { url: "https://example.com/photo.png" },
          output: {
            kind: "image",
            url: "https://example.com/photo.png",
            uploadUrl: image.url,
            filename: "Fetched photo",
            contentType: "image/png",
            byteLength: Buffer.from(png, "base64").length,
          },
        },
        {
          type: "tool-web_search",
          toolCallId: "search",
          state: "output-available",
          input: { query: "reference" },
          output: [
            {
              title: "Reference source",
              link: "https://example.com/reference",
              snippet: "Reference text",
            },
          ],
        },
        {
          type: "text",
          text:
            "## Research result\n\nA useful finding.\n\n```js\nconst answer = 42;\n```\n\n| Item | Value |\n| --- | --- |\n| Answer | 42 |\n\nInline math: $$x^2$$." +
            `\n\nRead <a href="${document.url}">original notes</a>.`,
        },
        {
          type: "tool-generate_image",
          toolCallId: "image",
          state: "output-available",
          output: {
            images: [
              {
                id: image.id,
                url: image.url,
                filename: "generated.png",
                mediaType: "image/png",
              },
            ],
            prompt: "Generated illustration",
            model: "Fixture image model",
            size: "auto",
            quality: "auto",
            referenceImageIds: [],
          },
        },
        {
          type: "tool-present_openui",
          toolCallId: "form",
          state: "output-available",
          input: { ui, text: "Choose a destination" },
          output: { displayed: true, text: "Choose a destination" },
        },
      ]),
      JSON.stringify({ secret: "private-message-metadata" }),
      2,
    );
    insert.run(
      "form-answer",
      "user",
      JSON.stringify([{ type: "text", text: "Plan Kyoto" }]),
      JSON.stringify({
        openuiAction: {
          messageId: "answer",
          toolCallId: "form",
          message: "Plan Kyoto",
          formState: { trip: { destination: { value: "Kyoto" } } },
        },
      }),
      3,
    );
    insert.run(
      "system",
      "system",
      JSON.stringify([{ type: "text", text: "Private system instruction" }]),
      null,
      4,
    );
  } finally {
    db.close();
  }
  return { image, document };
}

test("creates, previews, updates and revokes a complete chat; anonymous readers can view rich content and files", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const { image, document } = await setup(page);
  await page.goto("/chat/sharing-chat");
  await page.getByRole("button", { name: "Share chat", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share chat" });
  await dialog
    .getByText("Preview current conversation", { exact: true })
    .click();
  await expect(
    dialog.getByText("Explain the research", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByText("Preview current conversation", { exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Create link", exact: true })
    .click();
  const link = dialog.getByRole("textbox", { name: "Shared chat link" });
  await expect(link).toHaveValue(/\/share\/[0-9a-f-]+$/);
  const url = await link.inputValue();
  const id = url.split("/").at(-1)!;

  const anonymous = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const reader = await anonymous.newPage();
  const privateRequests: string[] = [];
  const errors: string[] = [];
  reader.on("pageerror", (error) => errors.push(error.message));
  reader.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/") &&
      !new URL(request.url()).pathname.startsWith("/api/share/")
    )
      privateRequests.push(request.url());
  });
  try {
    const response = await reader.goto(url);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(
      reader.getByRole("heading", { name: "Research reference", exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole("heading", { name: "Research result", exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole("table")).toBeVisible();
    await expect(reader.locator(".katex").first()).toBeVisible();
    await expect(
      reader.getByText("const answer = 42;", { exact: true }),
    ).toBeVisible();
    await expect(reader.getByAltText("photo.png")).toBeVisible();
    await expect(reader.getByAltText("Generated illustration")).toBeVisible();
    await expect(
      reader.getByRole("textbox", { name: "Destination", exact: true }),
    ).toHaveValue("Kyoto");
    await expect(
      reader.getByRole("button", { name: "Plan trip", exact: true }),
    ).toBeDisabled();
    await reader
      .getByRole("button", { name: "Searched the web", exact: true })
      .click();
    const fetchedImage = reader
      .getByRole("link", { name: /Fetched photo/ })
      .locator("img");
    await expect
      .poll(() =>
        fetchedImage.evaluate(
          (node) => (node as HTMLImageElement).naturalWidth,
        ),
      )
      .toBe(1);
    expect(await fetchedImage.getAttribute("src")).toBe(
      `/api/share/${id}/files/${image.id}`,
    );
    await reader
      .getByRole("button", { name: "original notes", exact: true })
      .click();
    const linkModal = reader.locator('[data-streamdown="link-safety-modal"]');
    await expect(linkModal).toContainText(
      `/api/share/${id}/files/${document.url.split("/").at(-1)}`,
    );
    await linkModal.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      reader.getByText("Visible reasoning from the conversation", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      reader.getByRole("link", { name: /Reference source/ }).first(),
    ).toBeVisible();
    for (const name of [
      "Edit",
      "Regenerate",
      "Continue response",
      "Read aloud",
      "Send message",
    ])
      await expect(
        reader.getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    const fileUrl = await reader
      .getByRole("link", { name: /notes.txt/ })
      .getAttribute("href");
    const attachment = await anonymous.request.get(new URL(fileUrl!, url).href);
    expect(attachment.status()).toBe(200);
    expect(await attachment.text()).toBe("Shared attachment contents");
    const bytes = await anonymous.request.get(
      new URL(`/api/share/${id}/files/${image.id}`, url).href,
    );
    expect(bytes.status()).toBe(200);
    expect(Buffer.from(await bytes.body()).toString("base64")).toBe(png);
    expect(
      (await anonymous.request.get(new URL(document.url, url).href)).status(),
    ).toBe(401);
    const publicBody = await (
      await anonymous.request.get(new URL(`/api/share/${id}`, url).href)
    ).text();
    for (const secret of [
      "Private system instruction",
      "private-provider-data",
      "private-message-metadata",
    ])
      expect(publicBody).not.toContain(secret);
    await reader.screenshot({
      path: testInfo.outputPath("shared-chat.png"),
      fullPage: true,
    });
    expect(privateRequests).toEqual([]);
    expect(errors).toEqual([]);

    const db = openE2eDatabase();
    try {
      db.prepare(
        "UPDATE chats SET title = 'Updated research' WHERE id = 'sharing-chat'",
      ).run();
      db.prepare(
        "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES ('later', 'sharing-chat', 'assistant', ?, 5)",
      ).run(
        JSON.stringify([{ type: "text", text: "A later private finding" }]),
      );
    } finally {
      db.close();
    }
    await reader.reload();
    await expect(
      reader.getByRole("heading", { name: "Research reference", exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByText("A later private finding", { exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Share chat", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Update link", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Update link", exact: true }),
    ).toBeEnabled();
    await expect(link).toHaveValue(url);
    await reader.reload();
    await expect(
      reader.getByRole("heading", { name: "Updated research", exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByText("A later private finding", { exact: true }),
    ).toBeVisible();

    await page.goto("/settings/data");
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Updated research", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Unshare", exact: true }).click();
    await expect(
      page.getByText("No shared chats.", { exact: true }),
    ).toBeVisible();
    await reader.reload();
    await expect(
      reader.getByRole("heading", {
        name: "Shared chat unavailable",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await anonymous.request.get(new URL(fileUrl!, url).href)).status(),
    ).toBe(404);
  } finally {
    await anonymous.close();
  }
});

test("shares every message in a long chat and works on a narrow touch viewport", async ({
  page,
  browser,
}) => {
  await setup(page);
  const db = openE2eDatabase();
  try {
    const insert = db.prepare(
      "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?, 'sharing-chat', 'assistant', ?, ?)",
    );
    for (let i = 0; i < 115; i++)
      insert.run(
        `long-${i}`,
        JSON.stringify([
          { type: "text", text: `Long conversation message ${i}` },
        ]),
        10 + i,
      );
  } finally {
    db.close();
  }
  // The submitted form value is beyond page one, but its form must display it immediately.
  const formDb = openE2eDatabase();
  try {
    formDb
      .prepare("UPDATE messages SET created_at = 1000 WHERE id = 'form-answer'")
      .run();
  } finally {
    formDb.close();
  }
  const response = await page.request.post("/api/chat/sharing-chat/share");
  const { share } = await response.json();
  const anonymous = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const reader = await anonymous.newPage();
    const firstPage = reader.waitForResponse((r) =>
      r.url().includes(`/api/share/${share.id}`),
    );
    await reader.goto(`/share/${share.id}`);
    expect((await (await firstPage).json()).messages).toHaveLength(50);
    await expect(
      reader.getByRole("textbox", { name: "Destination", exact: true }),
    ).toHaveValue("Kyoto");
    await expect(reader.locator("article")).toHaveCount(50);
    const secondPage = reader.waitForResponse((r) =>
      r.url().includes("?cursor="),
    );
    await reader.getByRole("button", { name: "Show more messages" }).tap();
    expect((await (await secondPage).json()).messages).toHaveLength(50);
    await expect(reader.locator("article")).toHaveCount(100);
    const thirdPage = reader.waitForResponse((r) =>
      r.url().includes("?cursor="),
    );
    await reader.getByRole("button", { name: "Show more messages" }).tap();
    expect((await (await thirdPage).json()).messages).toHaveLength(18);
    await expect(
      reader.getByText("Long conversation message 114", { exact: true }),
    ).toBeVisible();
    await expect(reader.locator("article")).toHaveCount(118);
    expect(
      await reader.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await anonymous.close();
  }
});

test("public tokens cannot manage chats or access unrelated files; deleting the original revokes the link", async ({
  page,
  browser,
}) => {
  const { image } = await setup(page);
  const { share } = await (
    await page.request.post("/api/chat/sharing-chat/share")
  ).json();
  const anonymous = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const response = await anonymous.request.fetch(
        `/api/chat/sharing-chat/share`,
        { method },
      );
      expect(response.status()).toBe(401);
    }
    expect((await anonymous.request.get("/api/shares")).status()).toBe(401);
    expect(
      (await anonymous.request.get("/api/chat/sharing-chat/messages")).status(),
    ).toBe(401);
    expect(
      (
        await anonymous.request.get(
          `/api/share/${share.id}/files/not-in-this-chat`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post("/api/chat/sharing-chat/share", {
          headers: {
            origin: "https://foreign.example",
            "sec-fetch-site": "cross-site",
          },
        })
      ).status(),
    ).toBe(403);
    await page.request.delete("/api/chats/sharing-chat");
    expect(
      (await anonymous.request.get(`/api/share/${share.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await anonymous.request.get(`/api/share/${share.id}/files/${image.id}`)
      ).status(),
    ).toBe(404);
  } finally {
    await anonymous.close();
  }
});

test("requires a fresh transcript when the owner updates between pages", async ({
  page,
  browser,
}) => {
  await setup(page);
  const db = openE2eDatabase();
  try {
    const insert = db.prepare(
      "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?, 'sharing-chat', 'assistant', ?, ?)",
    );
    for (let i = 0; i < 60; i++)
      insert.run(
        `more-${i}`,
        JSON.stringify([{ type: "text", text: `More ${i}` }]),
        10 + i,
      );
  } finally {
    db.close();
  }
  const { share } = await (
    await page.request.post("/api/chat/sharing-chat/share")
  ).json();
  const anonymous = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const reader = await anonymous.newPage();
    await reader.goto(`/share/${share.id}`);
    await expect(reader.locator("article")).toHaveCount(50);
    const editDb = openE2eDatabase();
    try {
      editDb
        .prepare(
          "UPDATE chats SET title = 'Updated reference' WHERE id = 'sharing-chat'",
        )
        .run();
    } finally {
      editDb.close();
    }
    expect((await page.request.put("/api/chat/sharing-chat/share")).ok()).toBe(
      true,
    );
    await reader.getByRole("button", { name: "Show more messages" }).click();
    await expect(reader.locator("main").getByRole("alert")).toContainText(
      "was updated",
    );
    await reader.getByRole("button", { name: "Reload shared chat" }).click();
    await expect(
      reader.getByRole("heading", { name: "Updated reference", exact: true }),
    ).toBeVisible();
    await expect(reader.locator("article")).toHaveCount(50);
    await reader.getByRole("button", { name: "Show more messages" }).click();
    await expect(reader.locator("article")).toHaveCount(63);
  } finally {
    await anonymous.close();
  }
});

test("serves anonymous shared pages and files through a LAN address", async ({
  page,
  browser,
}) => {
  const { document } = await setup(page);
  const { share } = await (
    await page.request.post("/api/chat/sharing-chat/share")
  ).json();
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal);
  expect(lan, "test host must have a LAN interface").toBeTruthy();
  const origin = new URL(page.url());
  origin.hostname = lan!.address;
  const anonymous = await browser.newContext();
  try {
    const reader = await anonymous.newPage();
    await reader.goto(new URL(`/share/${share.id}`, origin).href);
    await expect(
      reader.getByRole("heading", { name: "Research reference", exact: true }),
    ).toBeVisible();
    const file = reader.getByRole("link", { name: /notes.txt/ });
    const url = new URL((await file.getAttribute("href"))!, origin);
    expect(url.hostname).toBe(lan!.address);
    const response = await anonymous.request.get(url.href);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe("Shared attachment contents");
    expect(
      (
        await anonymous.request.get(new URL(document.url, origin).href)
      ).status(),
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
});

test("serves shared content through HTTPS at a Cloud-style hostname", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { image } = await setup(page);
  const { share } = await (
    await page.request.post("/api/chat/sharing-chat/share")
  ).json();
  const upstream = new URL(page.url()).origin;
  const folder = mkdtempSync(path.join(tmpdir(), "overtchat-share-proxy-"));
  const key = path.join(folder, "key.pem");
  const cert = path.join(folder, "cert.pem");
  const host = "share-test.overtchat.app";
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      `/CN=${host}`,
      "-addext",
      `subjectAltName=DNS:${host}`,
    ],
    { stdio: "ignore" },
  );
  const proxy = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      const target = httpRequest(
        new URL(req.url!, upstream),
        {
          method: req.method,
          headers: {
            ...req.headers,
            "x-forwarded-host": req.headers.host,
            "x-forwarded-proto": "https",
          },
        },
        (response) => {
          res.writeHead(response.statusCode!, response.headers);
          response.pipe(res);
        },
      );
      target.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(target);
      res.on("close", () => target.destroy());
    },
  );
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as { port: number }).port;
  const cloudBrowser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${host} 127.0.0.1`, "--no-proxy-server"],
  });
  try {
    const context = await cloudBrowser.newContext({ ignoreHTTPSErrors: true });
    const reader = await context.newPage();
    const errors: string[] = [];
    reader.on("pageerror", (e) => errors.push(e.message));
    const origin = `https://${host}:${port}`;
    const response = await reader.goto(`${origin}/share/${share.id}`);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(
      reader.getByRole("heading", { name: "Research reference", exact: true }),
    ).toBeVisible();
    await expect(reader.getByAltText("photo.png")).toBeVisible();
    await expect
      .poll(() =>
        reader
          .getByAltText("photo.png")
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    expect(
      await reader
        .getByAltText("photo.png")
        .evaluate((node) => (node as HTMLImageElement).src),
    ).toBe(`${origin}/api/share/${share.id}/files/${image.id}`);
    const text = await reader.evaluate(async (id) => {
      const response = await fetch(`/api/share/${id}`);
      return { status: response.status, body: await response.json() };
    }, share.id);
    expect(text.status).toBe(200);
    expect(text.body.title).toBe("Research reference");
    expect(errors).toEqual([]);
    await page.request.delete("/api/chat/sharing-chat/share");
    await reader.reload();
    await expect(
      reader.getByRole("heading", {
        name: "Shared chat unavailable",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await reader.evaluate(
        async (url) => (await fetch(url)).status,
        `/api/share/${share.id}/files/${image.id}`,
      ),
    ).toBe(404);
  } finally {
    await cloudBrowser.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  }
});
