import { expect, test } from "@playwright/test";
import {
  agentAttentionFixture,
  setupAgentAttention,
} from "./helpers/agent-attention";
import { resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

/** The alert the server sends the client it picked, as the stream carries it. */
const alert = `event: notification\ndata: ${JSON.stringify({
  sessionId: "approval",
  reason: "approval",
  eventId: "request",
  title: "Needs approval: Upgrade the parser",
  body: "Allow Bash · npm ci",
  provider: "codex",
})}\n\n`;

const SOUND_KEY = "overtchat:agent-alert-sound";
const SYSTEM_KEY = "overtchat:agent-alert-system";

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
  await expect(page.getByText("Needs approval: Upgrade the parser")).toHaveCount(0);

  await page.goto("/settings/general");
  const sound = page.getByRole("switch", { name: "Play a sound" });
  const system = page.getByRole("switch", { name: "System notifications" });
  await sound.click();
  await expect(sound).toBeChecked();
  await system.click();
  await expect(system).toBeChecked();
  await expect.poll(() => presence.at(-1)?.notify).toBe(true);
  expect(await page.evaluate(([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)], [SOUND_KEY, SYSTEM_KEY])).toEqual(["true", "true"]);

  // With the window in front, the alert is a toast that opens the session.
  await page.goto("/agents/new");
  const toast = page.getByRole("dialog", { name: "Needs approval: Upgrade the parser" });
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("Allow Bash · npm ci");
  await toast.getByRole("button", { name: "Open" }).click();
  await page.waitForURL("**/agents/approval");
  await expect.poll(() => presence.at(-1)?.viewing).toBe("approval");
});

test("uses a system notification while the window is in the background", async ({
  page,
}) => {
  await page.context().grantPermissions(["notifications"]);
  await page.addInitScript(
    ([soundKey, systemKey]) => {
      localStorage.setItem(soundKey, "false");
      localStorage.setItem(systemKey, "true");
      document.hasFocus = () => false;
      const shown: Array<{ title: string; body?: string; tag?: string }> = [];
      class FakeNotification {
        static permission = "granted";
        static requestPermission = async () => "granted";
        constructor(title: string, options: { body?: string; tag?: string } = {}) {
          shown.push({ title, ...options });
        }
        addEventListener() {}
        close() {}
      }
      Object.assign(window, { Notification: FakeNotification, __shownNotifications: shown });
    },
    [SOUND_KEY, SYSTEM_KEY],
  );
  await setupAgentAttention(page, agentAttentionFixture(), alert);
  await page.goto("/agents/new");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shownNotifications: unknown[] }).__shownNotifications))
    .toEqual([
      {
        title: "Needs approval: Upgrade the parser",
        body: "Allow Bash · npm ci",
        tag: "agent:approval",
        silent: true,
      },
    ]);
  await expect(page.getByRole("dialog", { name: "Needs approval: Upgrade the parser" })).toHaveCount(0);
});
