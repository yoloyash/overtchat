import { expect, test, type Page } from "@playwright/test";
import {
  agentAttentionFixture,
  setupAgentAttention,
} from "./helpers/agent-attention";
import { resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

// A browser lets a page start audio only once it has been clicked or typed
// in, and recording a trace reads the page in a way that counts as that.
test.use({ trace: "off" });

/** An alert the server sends the client it picked, as the stream carries it. */
const streamed = (notification: Record<string, string>) =>
  `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;

const alert = streamed({
  sessionId: "approval",
  reason: "approval",
  eventId: "request",
  title: "Needs approval: Upgrade the parser",
  body: "Allow Bash · npm ci",
  provider: "codex",
});

let finishedCount = 0;
const finished = (body: string) =>
  streamed({
    sessionId: "ready",
    reason: "completed",
    eventId: `turn-${finishedCount++}`,
    title: "Finished: Add pagination",
    body,
    provider: "claude",
  });

/** Alerts handed to the page one at a time, each on its next reconnect. */
function alertQueue() {
  const waiting: string[] = [];
  return {
    send: (item: string) => void waiting.push(item),
    next: () => waiting.shift() ?? "",
  };
}

const SOUND_KEY = "overtchat:agent-alert-sound";
const SYSTEM_KEY = "overtchat:agent-alert-system";
const alertsOn = (sound: boolean, system: boolean) =>
  [SOUND_KEY, SYSTEM_KEY, String(sound), String(system)] as const;

test("alerts stay off until turned on for the device, then open the session", async ({
  page,
}) => {
  const { presence } = await setupAgentAttention(page, agentAttentionFixture(), alert);
  await page.context().grantPermissions(["notifications"]);

  // The icon counts what needs you and what finished unseen, whatever the device wants.
  await expect(
    page.getByRole("button", { name: "Agents, 2 need you" }).filter({ visible: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.querySelector('link[rel~="icon"]')?.getAttribute("href"),
      ),
    )
    .toMatch(/^data:image\/png/);
  // The client reports in, saying it wants no alerts yet; so none is shown.
  await expect.poll(() => presence.at(-1)?.notify).toBe(false);
  expect(presence.at(-1)).toMatchObject({ visible: true, viewing: null });
  const toast = page.getByRole("dialog", { name: "Needs approval" });
  await expect(toast).toHaveCount(0);

  await page.goto("/settings/general");
  const sound = page.getByRole("switch", { name: "Play a sound" });
  const system = page.getByRole("switch", { name: "System notifications" });
  await sound.click();
  await expect(sound).toBeChecked();
  await system.click();
  await expect(system).toBeChecked();
  await expect.poll(() => presence.at(-1)?.notify).toBe(true);
  expect(await page.evaluate(([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)], [SOUND_KEY, SYSTEM_KEY])).toEqual(["true", "true"]);

  // With the window in front, the alert is a toast: the state, the session
  // and the request. Open goes to the session and closes it, though the
  // pointer is still on it.
  await page.goto("/agents/new");
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("Upgrade the parser");
  await expect(toast).toContainText("Allow Bash · npm ci");
  await toast.getByRole("button", { name: "Open" }).click();
  await page.waitForURL("**/agents/approval");
  await expect(toast).toHaveCount(0);
  await expect.poll(() => presence.at(-1)?.viewing).toBe("approval");
});

test("a toast leaves on its own, makes way for a newer one, and closes once its session is open", async ({
  page,
}) => {
  await page.addInitScript(([soundKey, systemKey, sound, system]) => {
    localStorage.setItem(soundKey, sound);
    localStorage.setItem(systemKey, system);
  }, alertsOn(true, false));
  const alerts = alertQueue();
  await setupAgentAttention(page, agentAttentionFixture(), alerts.next);
  await page.goto("/agents/history");
  const toast = page.getByRole("dialog", { name: "Finished" });

  // Left alone, it is gone after five seconds.
  await page.mouse.move(0, 0);
  alerts.send(finished("Added cursor pagination to /items."));
  await expect(toast).toHaveCount(1, { timeout: 15_000 });
  await expect(toast).toHaveCount(0, { timeout: 8_000 });

  // It waits while the pointer is on it. A newer alert for the session takes its place.
  alerts.send(finished("Added the first page."));
  await expect(toast).toContainText("Added the first page.", { timeout: 15_000 });
  await toast.hover();
  alerts.send(finished("Added the last page."));
  await expect(toast).toContainText("Added the last page.", { timeout: 15_000 });
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("Add pagination");

  // Opening the session any other way closes it too.
  await page.getByRole("main").getByRole("link", { name: /Add pagination/ }).click();
  await page.waitForURL("**/agents/ready");
  await expect(toast).toHaveCount(0);
});

test("uses a system notification while the window is in the background", async ({
  page,
}) => {
  await page.context().grantPermissions(["notifications"]);
  const { shown } = await watchSystemNotifications(page, alertsOn(false, true));
  await setupAgentAttention(page, agentAttentionFixture(), alert);
  await page.goto("/agents/new");
  await expect
    .poll(() => shown)
    .toEqual([
      {
        title: "Needs approval: Upgrade the parser",
        body: "Allow Bash · npm ci",
        tag: "agent:approval",
        silent: true,
      },
    ]);
  await expect(page.getByRole("dialog", { name: "Needs approval" })).toHaveCount(0);
});

test("the system makes the sound when the chime cannot play", async ({ page }) => {
  await page.context().grantPermissions(["notifications"]);
  const { shown, tones } = await watchSystemNotifications(page, alertsOn(true, true));
  const alerts = alertQueue();
  await setupAgentAttention(page, agentAttentionFixture(), alerts.next);

  // Freshly loaded and untouched, the page may not start audio; the
  // notification is left to make the system's sound.
  await page.goto("/agents/new");
  alerts.send(finished("Added the first page."));
  await expect
    .poll(() => shown, { timeout: 15_000 })
    .toMatchObject([{ body: "Added the first page.", silent: false }]);
  expect(tones()).toBe(0);

  // After a click the chime plays, and the notification stays quiet.
  await page.getByRole("heading", { name: "New Codex session" }).click();
  alerts.send(finished("Added the next page."));
  await expect
    .poll(() => shown, { timeout: 15_000 })
    .toMatchObject([{}, { body: "Added the next page.", silent: true }]);
  expect(tones()).toBe(2);

  // Audio the system stopped is asked back for, without another click.
  await page.evaluate(() =>
    (
      window as unknown as { __agentAlertAudio?: AudioContext }
    ).__agentAlertAudio?.suspend(),
  );
  alerts.send(finished("Added the last page."));
  await expect
    .poll(() => shown, { timeout: 15_000 })
    .toMatchObject([{}, {}, { body: "Added the last page.", silent: true }]);
  expect(tones()).toBe(4);
});

/**
 * Sets the device's alert choices, puts the window in the background, and
 * records what it shows and plays. The page reports these itself: asking it
 * with `evaluate` counts as using it, which lets a page play sound.
 */
async function watchSystemNotifications(
  page: Page,
  choices: ReturnType<typeof alertsOn>,
) {
  const shown: unknown[] = [];
  let tones = 0;
  await page.exposeFunction("__agentAlertShown", (item: unknown) => void shown.push(item));
  await page.exposeFunction("__agentAlertTone", () => void (tones += 1));
  await page.addInitScript(([soundKey, systemKey, sound, system]) => {
    localStorage.setItem(soundKey, sound);
    localStorage.setItem(systemKey, system);
    document.hasFocus = () => false;
    const report = window as unknown as {
      __agentAlertShown: (item: unknown) => void;
      __agentAlertTone: () => void;
      __agentAlertAudio?: AudioContext;
    };
    class FakeNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      constructor(title: string, options: { body?: string; tag?: string } = {}) {
        report.__agentAlertShown({ title, ...options });
      }
      addEventListener() {}
      close() {}
    }
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      report.__agentAlertTone();
      report.__agentAlertAudio = this;
      return createOscillator.call(this);
    };
    Object.assign(window, { Notification: FakeNotification });
  }, choices);
  return { shown, tones: () => tones };
}
