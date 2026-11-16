import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

type ChatMessage = { role: string; content?: string | { type: string; text?: string }[] | null };
type ChatPayload = {
  stream?: boolean;
  messages: ChatMessage[];
  tools?: Array<{ function?: { name?: string } }>;
};

let provider: Server;
let baseUrl: string;
const chatRequests: ChatPayload[] = [];
/** Replies the scripted model is holding open until a test lets go. */
const held: ServerResponse[] = [];

function text(message: ChatMessage | undefined): string {
  if (!message?.content) return "";
  return typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.text ?? "").join("\n");
}
const lastPrompt = (payload: ChatPayload) =>
  text(payload.messages.findLast((message) => message.role === "user"));
const skillListed = (payload: ChatPayload) =>
  text(payload.messages[0]).includes("<id>scheduled_tasks</id>");
const skillLoaded = (payload: ChatPayload) =>
  payload.messages.some((message) => text(message).includes('"name":"create_scheduled_task"'));

async function read(req: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString();
}

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    const payload = JSON.parse(await read(req)) as ChatPayload;
    if (!payload.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "title",
          object: "chat.completion",
          created: 1,
          model: "scheduled-test",
          choices: [{ index: 0, message: { role: "assistant", content: "Generated title" }, finish_reason: "stop" }],
        }),
      );
      return;
    }
    chatRequests.push(payload);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = (delta: unknown, finish: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id: "scheduled", object: "chat.completion.chunk", created: 1, model: "scheduled-test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    const toolCall = (name: string, args: object) => {
      event(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call-${chatRequests.length}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        null,
      );
      event({}, "tool_calls");
    };
    const prompt = lastPrompt(payload);
    const turn = payload.messages.findLastIndex((message) => message.role === "user");
    const steps = payload.messages.slice(turn).filter((message) => message.role === "tool");

    if (prompt.includes("long report")) {
      // A reply that is still being written until the test lets go of it.
      event({ role: "assistant", content: "The report begins. " }, null);
      held.push(res);
      return;
    }
    if (prompt.includes("every weekday at 8")) {
      if (!skillLoaded(payload) && skillListed(payload)) {
        toolCall("view_skill", { id: "scheduled_tasks" });
      } else if (skillLoaded(payload) && steps.length < 2) {
        toolCall("call_tool", {
          tool_name: "create_scheduled_task",
          params: {
            name: "Pull request review",
            prompt: "Remind me to review my open pull requests.",
            schedule: { frequency: "weekdays", time: "08:00" },
          },
        });
      } else if (skillLoaded(payload)) {
        event({ role: "assistant", content: "Scheduled for weekdays at 8." }, null);
        event({}, "stop");
      } else {
        event({ role: "assistant", content: "I cannot schedule anything." }, null);
        event({}, "stop");
      }
    } else {
      event({ role: "assistant", content: `Scripted answer to: ${prompt}` }, null);
      event({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  provider.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve())),
  );
});

function query<Row>(sql: string, ...params: unknown[]): Row[] {
  const db = openE2eDatabase();
  try {
    return db.prepare(sql).all(...params) as Row[];
  } finally {
    db.close();
  }
}
function execute(sql: string, ...params: unknown[]) {
  const db = openE2eDatabase();
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}
type RunRow = { status: string; trigger: string; error: string | null; chat_id: string | null; seen_at: number | null };
const runs = () =>
  query<RunRow>(
    "SELECT status, trigger, error, chat_id, seen_at FROM scheduled_task_runs ORDER BY started_at, rowid",
  );

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  chatRequests.length = 0;
  held.length = 0;
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Scheduled Admin");
  await page.locator("#email").fill("scheduled@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const model = await page.request.post("/api/model-configs", {
    data: {
      label: "Scheduled test",
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl,
      model: "scheduled-test",
      toolCallingEnabled: true,
    },
  });
  expect(model.ok()).toBeTruthy();
  execute("UPDATE server_capabilities SET provider = 'disabled' WHERE id = 'search'");
});

const sidebar = (page: Page) => page.locator("[data-desktop-sidebar]");
const scheduledLink = (page: Page) =>
  sidebar(page).getByRole("link", { name: /^Scheduled/ });
const taskRow = (page: Page, name: string) =>
  page.getByRole("list", { name: "Scheduled tasks" }).getByRole("listitem").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });

async function createTask(page: Page, name: string, prompt: string) {
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "New scheduled task" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Instructions").fill(prompt);
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("a task made on the Scheduled page runs by itself into a new chat", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await scheduledLink(page).click();
  await expect(page.getByRole("heading", { name: "Scheduled", exact: true })).toBeVisible();
  await expect(page.getByText("No scheduled tasks yet")).toBeVisible();

  // The form says what is missing before anything is saved.
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "New scheduled task" });
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give the task a name.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await createTask(page, "Morning news", "Summarize this morning's news.");
  const row = taskRow(page, "Morning news");
  await expect(row).toContainText("Every day at 9:00 AM · Scheduled test");
  await expect(row).toContainText("Next run");
  await expect(row.getByRole("switch", { name: "Morning news is on" })).toBeChecked();
  expect(chatRequests).toHaveLength(0);

  // Its time comes. Nothing in the browser asks for the run.
  execute("UPDATE scheduled_tasks SET next_run_at = ?", Date.now() - 1000);
  await expect.poll(() => runs().map((run) => run.status)).toEqual(["success"]);
  expect(chatRequests).toHaveLength(1);
  expect(lastPrompt(chatRequests[0])).toBe("Summarize this morning's news.");
  // A run sets up no tasks of its own.
  expect(skillListed(chatRequests[0])).toBe(false);
  // The task has moved on to tomorrow's time rather than running again.
  const [task] = query<{ next_run_at: number; enabled: number }>(
    "SELECT next_run_at, enabled FROM scheduled_tasks",
  );
  expect(task.enabled).toBe(1);
  expect(task.next_run_at).toBeGreaterThan(Date.now());

  // The open page finds out by itself: the chat is listed under the task's
  // name, marked as new, and the Scheduled link carries the same mark.
  const chat = sidebar(page).getByRole("link", { name: "Morning news" });
  await expect(chat).toBeVisible({ timeout: 45_000 });
  await expect(chat.getByRole("img", { name: "New result" })).toBeVisible();
  await expect(scheduledLink(page).getByRole("img", { name: "1 new result" })).toBeVisible();
  await expect(row).toContainText("Finished");
  await row.getByRole("button", { name: "Runs" }).click();
  const history = row.getByRole("list", { name: "Runs of Morning news" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history.getByRole("listitem")).toContainText("Finished");
  await expect(history.getByRole("listitem")).toContainText("New");

  // Opening the chat reads the result.
  await history.getByRole("link").click();
  await page.waitForURL("**/chat/*");
  await expect(page.getByText("Summarize this morning's news.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Scripted answer to: Summarize this morning's news.", { exact: true }),
  ).toBeVisible();
  await expect(sidebar(page).getByRole("img", { name: "New result" })).toHaveCount(0);
  await expect(scheduledLink(page).getByRole("img")).toHaveCount(0);
  await expect.poll(() => runs()[0].seen_at).not.toBeNull();
  // The task named the chat; no title was generated over it.
  expect(query<{ title: string }>("SELECT title FROM chats")).toEqual([{ title: "Morning news" }]);

  // Run now starts a second run beside the schedule.
  await scheduledLink(page).click();
  await row.getByRole("button", { name: "Actions for Morning news" }).click();
  await page.getByRole("menuitem", { name: "Run now" }).click();
  await expect(page.getByText("Running now", { exact: true }).first()).toBeVisible();
  await expect
    .poll(() => runs().map((run) => `${run.trigger}:${run.status}`))
    .toEqual(["schedule:success", "manual:success"]);
  await expect(sidebar(page).getByRole("link", { name: "Morning news" })).toHaveCount(2, {
    timeout: 15_000,
  });

  // Paused, its time passes without a run.
  await row.getByRole("switch", { name: "Morning news is on" }).click();
  await expect(row).toContainText("Paused");
  expect(query<{ enabled: number; next_run_at: number | null }>(
    "SELECT enabled, next_run_at FROM scheduled_tasks",
  )).toEqual([{ enabled: 0, next_run_at: null }]);
  await page.waitForTimeout(1500);
  expect(runs()).toHaveLength(2);

  // Deleting the task keeps the chats it wrote.
  await row.getByRole("button", { name: "Actions for Morning news" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No scheduled tasks yet")).toBeVisible();
  expect(query("SELECT id FROM scheduled_tasks")).toEqual([]);
  expect(query("SELECT id FROM chats")).toHaveLength(2);
});

test("a run in progress can be opened and stopped like any reply", async ({ page }) => {
  // Without it, a page only joins a reply that it started itself.
  test.skip(!process.env.REDIS_URL, "REDIS_URL is required to join a run in progress.");
  test.setTimeout(90_000);
  await page.goto("/scheduled");
  await createTask(page, "Long report", "Write the long report.");
  const row = taskRow(page, "Long report");
  await row.getByRole("button", { name: "Actions for Long report" }).click();
  await page.getByRole("menuitem", { name: "Run now" }).click();

  await expect.poll(() => held.length).toBe(1);
  await expect(row.getByRole("link", { name: "Running now" })).toBeVisible({ timeout: 15_000 });
  // A second run of the same task waits for the first.
  await row.getByRole("button", { name: "Actions for Long report" }).click();
  await expect(page.getByRole("menuitem", { name: "Run now" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  const again = await page.request.post(
    `/api/scheduled-tasks/${await row.getAttribute("data-task-id")}/run`,
  );
  expect(again.status()).toBe(409);

  // The run's chat shows a reply being written, with the composer's Stop.
  await row.getByRole("link", { name: "Running now" }).click();
  await page.waitForURL("**/chat/*");
  await expect(page.getByText("Write the long report.", { exact: true })).toBeVisible();
  const stop = page.getByRole("button", { name: "Stop generating" });
  await expect(stop).toBeVisible();
  await stop.click();

  await expect
    .poll(() => runs().map((run) => [run.status, run.error]))
    .toEqual([["interrupted", "Stopped by hand."]]);
  await expect(stop).toBeHidden();
  // A run the owner stopped does not count against the task.
  expect(query<{ enabled: number; failure_count: number }>(
    "SELECT enabled, failure_count FROM scheduled_tasks",
  )).toEqual([{ enabled: 1, failure_count: 0 }]);
  for (const reply of held) reply.end();
});

test("a chat sets a task up through the scheduled tasks skill", async ({ page }) => {
  await page.goto("/");
  await page.locator("textarea").fill("Remind me every weekday at 8 to review my pull requests.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Scheduled for weekdays at 8.", { exact: true })).toBeVisible();

  // The skill is listed, not loaded: the model views it, then runs its tool.
  expect(skillListed(chatRequests[0])).toBe(true);
  expect(skillLoaded(chatRequests[0])).toBe(false);
  expect(text(chatRequests[0].messages[0])).not.toContain("A scheduled task is a prompt");
  expect(skillLoaded(chatRequests[1])).toBe(true);

  // The task runs on this chat's model, at eight on the user's own clock.
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(
    query<{ name: string; prompt: string; schedule: string; time_zone: string; enabled: number; label: string }>(
      `SELECT t.name, t.prompt, t.schedule, t.time_zone, t.enabled, m.label
         FROM scheduled_tasks t JOIN model_configs m ON m.id = t.model_config_id`,
    ),
  ).toEqual([
    {
      name: "Pull request review",
      prompt: "Remind me to review my open pull requests.",
      schedule: JSON.stringify({ frequency: "weekdays", hour: 8, minute: 0 }),
      time_zone: zone,
      enabled: 1,
      label: "Scheduled test",
    },
  ]);

  // The reply shows what was scheduled, with a way to the page that lists it.
  const activity = page.getByRole("button", { name: "Scheduled “Pull request review”" }).last();
  await activity.click();
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  const timeline = activity.locator("xpath=following-sibling::div[1]");
  await expect(timeline).toContainText("Weekdays at 8:00 AM");
  await timeline.getByRole("link", { name: "View tasks" }).click();
  await page.waitForURL("**/scheduled");
  await expect(taskRow(page, "Pull request review")).toContainText(
    "Weekdays at 8:00 AM · Scheduled test",
  );
});
