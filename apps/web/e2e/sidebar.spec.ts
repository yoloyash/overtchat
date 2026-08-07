import { expect, test } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";

const SIDEBAR_STORAGE_KEY = "overtchat_sidebar_collapsed";

test.beforeEach(resetE2eDatabase);

test("sidebar behavior stays consistent across desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/signup");
  await page.locator("#name").fill("Sidebar Admin");
  await page.locator("#email").fill("sidebar-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const desktopSidebar = page.locator("[data-desktop-sidebar]");
  await expect(desktopSidebar).toHaveCSS("width", "256px");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(desktopSidebar).toHaveCSS("width", "0px");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SIDEBAR_STORAGE_KEY))
    .toBe("true");

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(desktopSidebar).toHaveCSS("width", "256px");
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
  await page.locator("main").click({ position: { x: 20, y: 20 } });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
    .not.toBe("hidden");

  await page.getByRole("button", { name: "New project" }).click();
  await page.locator("#project-name").fill("Sidebar Project");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL("**/projects/**");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();

  await drawer.getByRole("link", { name: "Sidebar Project", exact: true }).click();
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await drawer.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(drawer).toBeHidden();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SIDEBAR_STORAGE_KEY))
    .toBe("false");

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(drawer).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
    .not.toBe("hidden");
  await expect(desktopSidebar).toHaveCSS("width", "256px");
  await page.waitForTimeout(250);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(desktopSidebar).toHaveCSS("width", "0px");
  await page.addInitScript(() => {
    const samples: number[] = [];
    Object.assign(window, { __sidebarWidthSamples: samples });
    function sample() {
      const sidebar = document.querySelector<HTMLElement>(
        "[data-desktop-sidebar]",
      );
      if (sidebar) samples.push(sidebar.getBoundingClientRect().width);
      if (samples.length < 10) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __sidebarWidthSamples?: number[];
            }
          ).__sidebarWidthSamples?.[0],
      ),
    )
    .toBe(0);
});
