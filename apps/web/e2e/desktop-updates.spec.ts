import { expect, test, type Page } from "@playwright/test";
import type { DesktopUpdateState } from "@overtchat/shared/desktop";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

type PreviewWindow = Window & {
  __setDesktopUpdateState: (state: DesktopUpdateState) => void;
  __desktopInstallCount: number;
  __desktopDownloadCount: number;
};
const available: DesktopUpdateState = {
  currentVersion: "0.1.0", status: "available", availableVersion: "0.1.1", downloadPercent: null, message: null,
};

async function setUpdateState(page: Page, state: DesktopUpdateState) {
  await page.evaluate((next) => (window as unknown as PreviewWindow).__setDesktopUpdateState(next), state);
}

async function setup(page: Page) {
  await page.addInitScript((initial) => {
    let state = initial;
    const listeners = new Set<(state: DesktopUpdateState) => void>();
    Object.assign(window, {
      __desktopInstallCount: 0,
      __desktopDownloadCount: 0,
      __setDesktopUpdateState(next: DesktopUpdateState) { state = next; listeners.forEach((listener) => listener(next)); },
      overtchatDesktop: {
        onCommand: () => () => {},
        changeServer: async () => {},
        getUpdateState: async () => state,
        onUpdateState(listener: (state: DesktopUpdateState) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async checkForUpdates() {
          (window as unknown as PreviewWindow).__setDesktopUpdateState(initial);
          return initial;
        },
        async downloadUpdate() {
          (window as unknown as PreviewWindow).__desktopDownloadCount++;
          (window as unknown as PreviewWindow).__setDesktopUpdateState({ ...initial, status: "downloading", downloadPercent: 37 });
          return state;
        },
        async installUpdate() { (window as unknown as PreviewWindow).__desktopInstallCount++; },
      },
    });
  }, available);
  await page.route("**/api/ping", (route) => route.fulfill({ json: { version: "0.23.0", apiLevel: 1 } }));
  await page.route("**/api/app-update", (route) => route.fulfill({ json: {
    currentVersion: "0.23.0", latestVersion: "0.24.0", updateAvailable: true,
  } }));
  await page.goto("/signup");
  await page.locator("#name").fill("Desktop Tester");
  await page.locator("#email").fill("desktop-updates@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
}

test("both updates have independent actions, inline download, and a short restart confirmation", async ({ page }) => {
  await setup(page);
  const server = page.getByRole("button", { name: "Server update available", exact: true });
  const desktop = page.getByRole("button", { name: "Desktop app update available", exact: true });
  await expect(server).toBeVisible();
  await expect(desktop).toBeVisible();
  await desktop.hover();
  await expect(page.getByRole("tooltip")).toContainText("Desktop app update available");
  await desktop.click();
  await expect(page.getByRole("button", { name: "Downloading 37%" })).toBeDisabled();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as PreviewWindow).__desktopDownloadCount)).toBe(1);
  await setUpdateState(page, { ...available, status: "ready", downloadPercent: 100 });
  const restart = page.getByRole("button", { name: "Desktop update ready", exact: true });
  await expect(restart).toBeVisible();
  await server.click();
  const serverDialog = page.getByRole("dialog", { name: "Server update available" });
  await expect(serverDialog.getByLabel("OvertChat update command")).toHaveText("overtchat update");
  await serverDialog.getByRole("button", { name: "Close" }).click();
  await expect(restart).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as PreviewWindow).__desktopInstallCount)).toBe(0);
  await restart.click();
  const confirmation = page.getByRole("dialog", { name: "Update ready", exact: true });
  await expect(confirmation).toContainText("Restart to install v0.1.1?");
  await confirmation.getByRole("button", { name: "Later" }).click();
  expect(await page.evaluate(() => (window as unknown as PreviewWindow).__desktopInstallCount)).toBe(0);
  await page.getByRole("button", { name: /Desktop Tester/ }).click();
  const version = page.getByText("OvertChat v0.1.0", { exact: true });
  await expect(version).toBeVisible();
  await version.hover();
  await expect(page.getByRole("tooltip")).toContainText("Desktop v0.1.0 · Server v0.23.0");
  await page.mouse.move(400, 400);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await restart.click();
  await confirmation.getByRole("button", { name: "Update and restart", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as PreviewWindow).__desktopInstallCount)).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("members can retry their desktop without server controls", async ({ page }) => {
  await setup(page);
  const db = openE2eDatabase();
  try { db.prepare("UPDATE user SET role = 'user'").run(); } finally { db.close(); }
  await page.reload();
  await expect(page.getByRole("button", { name: "Desktop app update available", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Server update available", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Desktop Tester/ }).click();
  await expect(page.getByRole("menuitem", { name: "Administration" })).toHaveCount(0);
  await page.mouse.move(400, 400);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await setUpdateState(page, { ...available, status: "error", message: "Download interrupted" });
  const retry = page.getByRole("button", { name: "Retry desktop update", exact: true });
  await retry.hover();
  await expect(page.getByRole("tooltip")).toContainText("Download interrupted");
  await retry.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as PreviewWindow).__desktopDownloadCount)).toBe(1);
  await expect(page.getByRole("button", { name: "Downloading 37%" })).toBeVisible();
});

test("blocked desktop updates use existing server instructions and cannot restart", async ({ page }) => {
  await setup(page);
  await setUpdateState(page, { ...available, status: "blocked", message: "Update your OvertChat server first." });
  const blocked = page.getByRole("button", { name: "Update requires attention", exact: true });
  await blocked.hover();
  await expect(page.getByRole("tooltip")).toContainText("Update your OvertChat server first.");
  await blocked.click();
  await expect(page.getByRole("dialog", { name: "Server update available" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Desktop update ready" })).toHaveCount(0);
});

test("both update actions fit and work in the mobile drawer", async ({ page }) => {
  await setup(page);
  await setUpdateState(page, { ...available, status: "ready", downloadPercent: 100 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  const restart = drawer.getByRole("button", { name: "Desktop update ready", exact: true });
  const server = drawer.getByRole("button", { name: "Server update available", exact: true });
  await expect(restart).toBeVisible();
  await expect(server).toBeVisible();
  await expect.poll(() => drawer.evaluate((element) => {
    const action = element.querySelector('[aria-label="Desktop update ready"]')!;
    return action.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1;
  })).toBe(true);
  await server.click();
  const serverDialog = page.getByRole("dialog", { name: "Server update available" });
  await expect(serverDialog).toBeVisible();
  await serverDialog.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeVisible();
  await restart.click();
  await page.getByRole("dialog", { name: "Update ready", exact: true }).getByRole("button", { name: "Update and restart", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as PreviewWindow).__desktopInstallCount)).toBe(1);
});
