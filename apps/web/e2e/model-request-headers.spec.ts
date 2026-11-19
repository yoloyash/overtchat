import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

const SESSION_HEADER = "x-gateway-session";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHAT_DIGEST = /^[A-Za-z0-9_-]{43}$/;

interface GatewayCall {
  path: string;
  session: string | undefined;
  team: string | undefined;
  stream: boolean;
}

let gateway: Server;
let gatewayOrigin: string;
const calls: GatewayCall[] = [];

/**
 * A gateway that, like some hosted ones, refuses every request that does not
 * name a session in a header, before it looks at anything else.
 */
test.beforeAll(async () => {
  gateway = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? (JSON.parse(text) as { stream?: boolean }) : {};
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value.join(", ") : value;
    };
    const session = header(SESSION_HEADER);
    calls.push({
      path: req.url ?? "",
      session,
      team: header("x-team"),
      stream: body.stream === true,
    });
    if (!session) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { type: "MissingSessionID", message: "Request is missing its session header." },
        }),
      );
      return;
    }
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "gateway-model", object: "model" }] }));
      return;
    }
    const created = Math.floor(Date.now() / 1_000);
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "reply",
          object: "chat.completion",
          created,
          model: "gateway-model",
          choices: [
            { index: 0, message: { role: "assistant", content: "Gateway chat" }, finish_reason: "stop" },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    for (const event of [
      { id: "c", object: "chat.completion.chunk", created, model: "gateway-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "Routed by session" }, finish_reason: null }] },
      { id: "c", object: "chat.completion.chunk", created, model: "gateway-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  gatewayOrigin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    gateway.close((error) => (error ? reject(error) : resolve())),
  );
});

async function createAdmin(page: Page) {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Header Admin");
  await page.locator("#email").fill("header-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
}

function storedHeaders(): unknown {
  const db = openE2eDatabase();
  try {
    const row = db
      .prepare("SELECT headers FROM model_configs WHERE model = 'gateway-model'")
      .get() as { headers: string | null } | undefined;
    return row?.headers ? JSON.parse(row.headers) : (row?.headers ?? undefined);
  } finally {
    db.close();
  }
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByPlaceholder("Message… or / for commands");
  await composer.fill(text);
  await composer.press("Enter");
}

test("a model sends its request headers, with one session ID per conversation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  calls.length = 0;
  await createAdmin(page);

  await page.goto("/settings/models/new");
  await page.locator("#p-provider").click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await page.locator("#p-base-url").fill(`${gatewayOrigin}/v1`);
  await page.locator("#p-model").fill("gateway-model");
  await page.getByRole("switch", { name: "Disable tool calling" }).click();

  // Without the header the gateway turns the connection test away.
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Request is missing its session header.")).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ path: "/v1/chat/completions", session: undefined });

  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Request headers key 1").fill(SESSION_HEADER);
  // A header without a value cannot be saved or tested.
  await expect(
    page.getByText(`The ${SESSION_HEADER} request header needs a value`),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add model" })).toBeDisabled();
  await page.getByLabel("Request headers value 1").fill("{{CHAT_ID}}");
  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Request headers key 2").fill("X-Team");
  await page.getByLabel("Request headers value 2").fill("search platform");

  // The same test now passes; outside a chat the session is a fresh ID.
  calls.length = 0;
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Gateway chat")).toBeVisible();
  const tested = calls.filter((call) => call.path === "/v1/chat/completions");
  expect(tested).toHaveLength(1);
  expect(tested[0].session).toMatch(UUID);
  expect(tested[0].team).toBe("search platform");

  await page.getByRole("button", { name: "Add model" }).click();
  await page.waitForURL("**/settings/models");
  expect(storedHeaders()).toEqual({
    [SESSION_HEADER]: "{{CHAT_ID}}",
    "X-Team": "search platform",
  });

  // People who chat with the model never receive its headers.
  const publicList = await (await page.request.get("/api/model-configs")).text();
  expect(publicList).toContain("gateway-model");
  expect(publicList).not.toContain(SESSION_HEADER);

  // Switching the model off and on from the list keeps the headers.
  await page.getByRole("switch", { name: "Disable gateway-model" }).click();
  await page.getByRole("switch", { name: "Enable gateway-model" }).click();
  await expect(page.getByRole("switch", { name: "Disable gateway-model" })).toBeVisible();
  expect(storedHeaders()).toEqual({
    [SESSION_HEADER]: "{{CHAT_ID}}",
    "X-Team": "search platform",
  });

  // Two turns of one chat share a session; its title request does too.
  calls.length = 0;
  await page.goto("/");
  await sendMessage(page, "First question");
  await expect(page.getByText("Routed by session")).toHaveCount(1);
  await page.waitForURL(/\/chat\//);
  await sendMessage(page, "Second question");
  await expect(page.getByText("Routed by session")).toHaveCount(2);
  await expect.poll(() => calls.filter((call) => !call.stream).length).toBe(1);
  const firstChat = [...calls];
  expect(firstChat.filter((call) => call.stream)).toHaveLength(2);
  const firstSession = firstChat[0].session;
  expect(firstSession).toMatch(CHAT_DIGEST);
  expect(firstChat.every((call) => call.session === firstSession)).toBe(true);
  expect(firstChat.every((call) => call.team === "search platform")).toBe(true);
  // The session identifies the conversation without being its ID.
  const chatId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(chatId).not.toBe("");
  expect(firstSession).not.toContain(chatId);

  // Another chat gets another session.
  calls.length = 0;
  await page.goto("/");
  await sendMessage(page, "Unrelated question");
  await expect(page.getByText("Routed by session")).toHaveCount(1);
  const secondSession = calls.find((call) => call.stream)?.session;
  expect(secondSession).toMatch(CHAT_DIGEST);
  expect(secondSession).not.toBe(firstSession);

  // Editing shows the saved headers; removing one stops sending it.
  await page.goto("/settings/models");
  await page.getByLabel("Edit gateway-model").click();
  await expect(page.getByLabel("Request headers key 1")).toHaveValue(SESSION_HEADER);
  await expect(page.getByLabel("Request headers value 2")).toHaveValue("search platform");
  await page.getByRole("button", { name: "Remove request headers row" }).nth(1).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/settings/models");
  expect(storedHeaders()).toEqual({ [SESSION_HEADER]: "{{CHAT_ID}}" });
});

test("model discovery sends the headers being edited", async ({ page }) => {
  calls.length = 0;
  await createAdmin(page);
  const discover = (headers?: Record<string, string>) =>
    page.request.post("/api/models", {
      data: {
        providerId: "custom",
        apiFormat: "openai-chat",
        baseUrl: `${gatewayOrigin}/v1`,
        ...(headers ? { headers } : {}),
      },
    });

  const refused = await discover();
  expect(refused.status()).toBe(502);
  expect(await refused.text()).toContain("MissingSessionID");

  const listed = await discover({ [SESSION_HEADER]: "{{CHAT_ID}}" });
  expect(listed.status(), await listed.text()).toBe(200);
  expect(await listed.json()).toMatchObject({ models: [{ id: "gateway-model" }] });
  expect(calls.at(-1)?.session).toMatch(UUID);

  const invalid = await discover({ "Content-Type": "text/plain" });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toEqual({
    error: "The Content-Type request header is set by the app and cannot be changed",
  });
});
