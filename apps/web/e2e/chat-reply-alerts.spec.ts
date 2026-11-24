import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

let server: Server;
let endpoint: string;
let replies = 0;
let pending: (() => void)[] = [];

const SOUND_KEY = "overtchat:agent-alert-sound";
const SYSTEM_KEY = "overtchat:agent-alert-system";

type Shown = { title: string; body?: string; tag?: string; silent?: boolean };

/**
 * Signs in with a model whose replies the test finishes by hand, and gives
 * the page a window whose focus the test controls and a browser that reports
 * the notifications it is asked to show. A headless browser reports
 * notifications as blocked whatever it was granted.
 */
async function setup(page: Page, choices: { system: boolean } | null) {
  resetE2eDatabase();
  replies = 0;
  pending = [];
  const shown: Shown[] = [];
  const closed: string[] = [];
  await page.exposeFunction("__replyAlertShown", (item: Shown) => void shown.push(item));
  await page.exposeFunction("__replyAlertClosed", (tag: string) => void closed.push(tag));
  await page.addInitScript(
    ([soundKey, systemKey, system]) => {
      if (system !== null && localStorage.getItem(systemKey) === null) {
        localStorage.setItem(soundKey, "false");
        localStorage.setItem(systemKey, system);
      }
      const state = window as unknown as {
        __focused: boolean;
        __replyAlertShown: (item: unknown) => void;
        __replyAlertClosed: (tag: string) => void;
      };
      state.__focused = true;
      document.hasFocus = () => state.__focused;
      class FakeNotification {
        static get permission() {
          return sessionStorage.getItem("notification-access") ?? "default";
        }
        static requestPermission = async () => {
          sessionStorage.setItem("notification-access", "granted");
          return "granted";
        };
        private readonly tag: string;
        constructor(title: string, options: { body?: string; tag?: string } = {}) {
          this.tag = options.tag ?? "";
          state.__replyAlertShown({ title, ...options });
        }
        addEventListener() {}
        close() {
          state.__replyAlertClosed(this.tag);
        }
      }
      if (system === "true") sessionStorage.setItem("notification-access", "granted");
      Object.assign(window, { Notification: FakeNotification });
    },
    [SOUND_KEY, SYSTEM_KEY, choices ? String(choices.system) : null] as const,
  );
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Reply Tester");
  await page.locator("#email").fill("reply@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const response = await page.request.post("/api/model-configs", {
    data: {
      label: "Reply fixture",
      providerId: "vllm",
      apiFormat: "auto",
      baseUrl: endpoint,
      model: "reply-fixture",
      apiKey: "test",
      toolCallingEnabled: false,
      contextWindow: 8192,
      providerOptions: { max_tokens: 128, temperature: 0 },
      enabled: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  const { modelConfig } = await response.json();
  await page.request.put("/api/model-preferences", {
    data: { defaultModelId: modelConfig.id },
  });
  await page.reload();
  // The composer sends nothing until it knows its model.
  await expect(page.getByRole("button", { name: "Reply fixture" })).toBeVisible();
  return { shown, closed };
}

/** Puts the window behind another, or back in front as a person would. */
const focus = (page: Page, focused: boolean) =>
  page.evaluate((next) => {
    (window as unknown as { __focused: boolean }).__focused = next;
    if (next) window.dispatchEvent(new Event("focus"));
  }, focused);

/** Sends a prompt and waits until the reply is under way. */
async function ask(page: Page, text: string) {
  const input = page.getByRole("combobox");
  await input.fill(text);
  await input.press("Enter");
  await expect(page.getByLabel("Stop generating")).toBeVisible();
  await expect.poll(() => pending.length).toBe(1);
}

/** Lets the reply under way finish, and waits until the page has it all. */
async function finish(page: Page) {
  pending.shift()!();
  await expect(page.getByLabel("Stop generating")).toHaveCount(0);
}

function send(res: ServerResponse, content: string, done = false) {
  res.write(
    `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "reply-fixture", choices: [{ index: 0, delta: { content }, finish_reason: done ? "stop" : null }], ...(done ? { usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } } : {}) })}\n\n`,
  );
  if (done) res.end("data: [DONE]\n\n");
}

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.stream !== true) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created: 1,
          model: "reply-fixture",
          choices: [
            { index: 0, message: { role: "assistant", content: "Reply test" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }
    replies += 1;
    res.setHeader("Content-Type", "text/event-stream");
    send(res, `Reply ${replies} is `);
    pending.push(() => send(res, "ready.", true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("says a reply finished in the background, and nothing about one that was watched or stopped", async ({
  page,
}) => {
  const { shown, closed } = await setup(page, { system: true });

  // Watched: the reply is on the page, so nothing else is said.
  await ask(page, "First");
  await finish(page);
  await page.waitForURL("**/chat/*");
  const chatId = page.url().split("/").at(-1)!;
  expect(shown).toEqual([]);

  // Finished behind another window: a system notification with the reply.
  await ask(page, "Second");
  await focus(page, false);
  await finish(page);
  await expect
    .poll(() => shown)
    .toEqual([
      {
        title: "Your response is ready",
        body: "Reply 2 is ready.",
        tag: `chat:${chatId}`,
        silent: true,
      },
    ]);
  expect(closed).toEqual([]);

  // Coming back to the window takes it down.
  await focus(page, true);
  await expect.poll(() => closed).toEqual([`chat:${chatId}`]);

  // Stopped by hand, even from the background: not a reply to announce.
  await ask(page, "Third");
  await focus(page, false);
  await page.getByLabel("Stop generating").click();
  await expect(page.getByLabel("Stop generating")).toHaveCount(0);
  pending = [];
  await focus(page, true);
  await ask(page, "Fourth");
  await finish(page);
  expect(shown).toHaveLength(1);
});

test("offers alerts in a chat once a reply has finished unseen", async ({ page }, testInfo) => {
  const { shown } = await setup(page, null);
  const offer = page.getByRole("region", { name: "Alerts" });

  // Nothing to offer while replies are watched.
  await ask(page, "First");
  await finish(page);
  await expect(offer).toHaveCount(0);

  await ask(page, "Second");
  await focus(page, false);
  await finish(page);
  await focus(page, true);
  await expect(offer).toContainText("Get notified when an agent needs you or a reply is ready.");
  await page.screenshot({ path: testInfo.outputPath("chat-alerts-offer.png") });
  expect(shown).toEqual([]);

  // Taking it turns alerts on for the next reply.
  await offer.getByRole("button", { name: "Enable notifications" }).click();
  await expect(offer).toHaveCount(0);
  expect(
    await page.evaluate(
      ([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)],
      [SOUND_KEY, SYSTEM_KEY],
    ),
  ).toEqual(["true", "true"]);
  await ask(page, "Third");
  await focus(page, false);
  await finish(page);
  await expect.poll(() => shown).toMatchObject([{ title: "Your response is ready", body: "Reply 3 is ready." }]);
});
