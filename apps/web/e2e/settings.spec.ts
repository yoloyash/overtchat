import { expect, test } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";
import { accentBackgrounds } from "@overtchat/shared/theme-backgrounds";

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Settings Tester");
  await page.getByLabel("Email").fill("settings@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
});

test("appearance controls align, support the keyboard, and persist", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/settings/general");
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  const font = page.getByRole("combobox", { name: "Interface font" });
  await expect(font.locator('[data-slot="select-value"]')).toHaveText(
    "Plus Jakarta Sans",
  );
  await expect(
    page.getByRole("link", { name: "General", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  const themeBox = (await theme.boundingBox())!;
  const fontBox = (await font.boundingBox())!;
  expect(Math.abs(themeBox.x - fontBox.x)).toBeLessThan(1);
  expect(Math.abs(themeBox.width - fontBox.width)).toBeLessThan(1);
  expect(Math.abs(themeBox.height - fontBox.height)).toBeLessThan(1);
  for (const icon of await theme.locator("svg").all()) {
    const box = (await icon.boundingBox())!;
    expect(box.width).toBe(14);
    expect(box.height).toBe(14);
  }

  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await font.click();
  await page.getByRole("option", { name: "System", exact: true }).click();
  await page.getByRole("switch", { name: "Message stats", exact: true }).click();
  await page.reload();
  await expect(font.locator('[data-slot="select-value"]')).toHaveText("System");
  await expect(
    page.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Message stats", exact: true }),
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("general-desktop.png") });

  await page.setViewportSize({ width: 375, height: 812 });
  const labelBox = (await page
    .locator('label[for="message-stats"]')
    .boundingBox())!;
  const switchBox = (await page
    .getByRole("switch", { name: "Message stats", exact: true })
    .boundingBox())!;
  expect(switchBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
  expect(switchBox.y).toBeLessThan(labelBox.y + 55);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.screenshot({ path: testInfo.outputPath("general-mobile.png") });
  await page.getByRole("combobox", { name: "Settings page" }).click();
  await page.getByRole("option", { name: "Profile", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true }),
  ).toBeVisible();
});

test("all settings pages fit narrow screens and MCP transport preserves draft fields", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [route, title] of [
    ["general", "General"],
    ["personalization", "Personalization"],
    ["tools", "Tools"],
    ["profile", "Profile"],
    ["account", "Security"],
    ["data", "Data"],
    ["models", "Models"],
    ["services", "Services"],
    ["connections", "Agents"],
    ["users", "Users"],
    ["models/new", "Add model"],
    ["tools/mcp/new", "Add MCP server"],
  ]) {
    await page.goto(`/settings/${route}`);
    await expect(
      page
        .getByRole("heading", { name: title, exact: title !== "Agents" })
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      route,
    ).toBe(375);
    const overflow = await page
      .locator('div[class*="overflow-y-auto"]')
      .evaluateAll((elements) =>
        elements
          .filter(
            (element) =>
              element.clientWidth > 0 &&
              element.scrollWidth > element.clientWidth + 1,
          )
          .map((element) => element.className),
      );
    expect(overflow, route).toEqual([]);
  }

  await page.getByLabel("Name", { exact: true }).fill("My tools");
  await page.getByLabel("Command to launch").fill("npx");
  await page.getByLabel("Arguments value 1", { exact: true }).fill("-y");
  await page.getByRole("button", { name: "Add argument", exact: true }).click();
  await expect(
    page.getByLabel("Arguments value 2", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Streamable HTTP", exact: true })
    .click();
  await expect(page.getByLabel("Server URL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Command to launch")).toHaveCount(0);
  await page.getByRole("radio", { name: "STDIO", exact: true }).click();
  await expect(page.getByLabel("Command to launch")).toHaveValue("npx");
  await expect(
    page.getByLabel("Arguments value 1", { exact: true }),
  ).toHaveValue("-y");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "My tools",
  );
  await page.screenshot({ path: testInfo.outputPath("mcp-mobile.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/tools$/);
});

test("accent palettes update live, persist, and stay local to a browser", async ({ page, context, browser }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings/general");
  const accent = page.getByRole("radiogroup", { name: "Accent color" });
  const root = page.locator("html");
  const chrome = page.locator('meta[name="theme-color"]');
  await expect(chrome).toHaveCount(1);
  await expect(accent.getByRole("radio", { name: "Olive", exact: true })).toBeChecked();
  const secondTab = await context.newPage();
  await secondTab.goto("/settings/general");

  const color = () => root.evaluate((el) => getComputedStyle(el).getPropertyValue("--primary"));
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  const defaultColor = await color();
  for (const label of ["Green", "Teal", "Blue", "Violet", "Rose", "Amber", "Neutral"]) {
    await accent.getByRole("radio", { name: label, exact: true }).click();
    await expect(root).toHaveAttribute("data-accent", label.toLowerCase());
    await expect(secondTab.locator("html")).toHaveAttribute("data-accent", label.toLowerCase());
    expect(await color()).not.toBe(defaultColor);
  }

  await accent.getByRole("radio", { name: "Blue", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(accent.getByRole("radio", { name: "Violet", exact: true })).toBeChecked();
  const lightColor = await color();
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(root).toHaveClass(/dark/);
  expect(await color()).not.toBe(lightColor);
  await page.reload();
  await expect(root).toHaveAttribute("data-accent", "violet");
  await expect(chrome).toHaveAttribute("content", accentBackgrounds.violet.dark);
  await expect(accent.getByRole("radio", { name: "Violet", exact: true })).toBeChecked();

  // The preference must be applied even before the client bundle can hydrate.
  await page.route(/\/_next\/.*\.js(?:\?|$)/, (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-accent", "violet");
  await expect(chrome).toHaveAttribute("content", accentBackgrounds.violet.dark);
  await page.unrouteAll();
  await page.reload();

  await page.getByRole("radio", { name: "System", exact: true }).click();
  await expect(chrome).toHaveAttribute("content", accentBackgrounds.violet.light);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(chrome).toHaveAttribute("content", accentBackgrounds.violet.dark);
  await accent.getByRole("radio", { name: "Blue", exact: true }).click();
  await expect(chrome).toHaveAttribute("content", accentBackgrounds.blue.dark);
  // Its system appearance is light; the accent preference still syncs.
  await expect(secondTab.locator('meta[name="theme-color"]')).toHaveAttribute("content", accentBackgrounds.blue.light);

  const freshContext = await browser.newContext({ storageState: { cookies: await context.cookies(), origins: [] } });
  const freshPage = await freshContext.newPage();
  await freshPage.goto(new URL("/settings/general", page.url()).href);
  await expect(freshPage.getByRole("radio", { name: "Olive", exact: true })).toBeChecked();
  await freshContext.close();

  await page.setViewportSize({ width: 375, height: 812 });
  await accent.getByRole("radio", { name: "Olive", exact: true }).click();
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(root).toHaveAttribute("data-accent", "olive");
  expect(await color()).toBe(defaultColor);
  expect(await root.evaluate((el) => el.scrollWidth)).toBe(375);

  // Shadows disappear in Windows high contrast; focus and selection must survive.
  await page.emulateMedia({ forcedColors: "active" });
  await accent.getByRole("radio", { name: "Blue", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  const selected = accent.getByRole("radio", { name: "Violet", exact: true });
  await expect(selected).toBeFocused();
  await expect(selected).toBeChecked();
  await expect(selected.locator("svg")).toBeVisible();
  await expect(selected).toHaveCSS("outline-style", "solid");
  await expect(selected).toHaveCSS("outline-width", "2px");
  await expect(accent.locator("svg:visible")).toHaveCount(1);
  await page.emulateMedia({ forcedColors: "none" });

  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  for (const tile of await accent.getByRole("radio").all()) {
    expect(await tile.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });

  await page.evaluate(() => localStorage.setItem("overtchat_accent", JSON.stringify("invalid")));
  await page.reload();
  await expect(accent.getByRole("radio", { name: "Olive", exact: true })).toBeChecked();
  await expect(root).toHaveAttribute("data-accent", "olive");
});
