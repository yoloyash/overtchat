import { expect, test, type Page } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";

const SIDEBAR_STORAGE_KEY = "overtchat_sidebar_collapsed";

test.beforeEach(resetE2eDatabase);

async function getTransitionProperties(page: Page) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (animation): animation is CSSTransition =>
          animation instanceof CSSTransition,
      )
      .map((transition) => transition.transitionProperty),
  );
}

test("sidebar behavior stays consistent across desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/api/app-update", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        currentVersion: "0.16.0",
        latestVersion: "99.0.0",
        updateAvailable: true,
      }),
    });
  });
  await page.goto("/signup");
  await page.locator("#name").fill("Sidebar Admin");
  await page.locator("#email").fill("sidebar-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const accountButton = page.getByRole("button", {
    name: "Sidebar Admin Update available v99.0.0",
  });
  await expect(accountButton).toBeVisible();
  await accountButton.click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Administration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Update available v99.0.0" }),
  ).toHaveAttribute("href", "https://overtchat.com/releases/");
  await expect(page.getByRole("menuitem", { name: "Privacy" })).toHaveAttribute(
    "href",
    "https://overtchat.com/privacy/",
  );
  await expect(page.getByText(/^OvertChat v\d+\.\d+\.\d+$/)).toBeVisible();
  await page.keyboard.press("Escape");

  const desktopSidebar = page.locator("[data-desktop-sidebar]");
  const desktopPanel = page.locator("[data-desktop-sidebar-panel]");
  await expect(desktopSidebar).toHaveCSS("width", "256px");
  await expect(desktopPanel).toHaveCSS(
    "transition-property",
    "transform, translate, scale, rotate",
  );

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  expect(await getTransitionProperties(page)).toEqual(
    expect.arrayContaining(["translate", "width"]),
  );
  await expect(desktopSidebar).toHaveCSS("width", "0px");
  await expect(desktopPanel).toHaveCSS("translate", "-100%");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SIDEBAR_STORAGE_KEY))
    .toBe("true");

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(desktopSidebar).toHaveCSS("width", "256px");
  await expect(desktopPanel).toHaveCSS("translate", "none");
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
  await page.goto("/settings/general");
  const settingsPicker = page.getByRole("combobox", {
    name: "Settings page",
  });
  await expect(settingsPicker).toContainText("General");
  await settingsPicker.click();
  const settingsOptions = page.getByRole("listbox");
  await expect(
    settingsOptions.getByText("Preferences", { exact: true }),
  ).toBeVisible();
  await expect(
    settingsOptions.getByText("Administration", { exact: true }),
  ).toBeVisible();
  await settingsOptions.getByRole("option", { name: "Security" }).click();
  await page.waitForURL("**/settings/account");
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();

  await page.getByRole("button", { name: "Open sidebar" }).click();
  expect(await getTransitionProperties(page)).toContain("translate");
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS(
    "transition-property",
    "transform, translate, scale, rotate",
  );
  const mobileAccountButton = drawer.getByRole("button", {
    name: "Sidebar Admin Update available v99.0.0",
  });
  await expect(mobileAccountButton).toBeVisible();
  await mobileAccountButton.click();
  await expect(
    page.getByRole("menuitem", { name: "Update available v99.0.0" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
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
