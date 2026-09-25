import { expect, test } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";

test.beforeEach(async ({ page }) => {
  resetE2eDatabase();
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Mobile Tester");
  await page.getByLabel("Email").fill("mobile@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
});

for (const mobile of [false, true]) {
  test(`mobile download and connection dialog on ${mobile ? "phone" : "desktop"}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize(
      mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 },
    );
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.getByRole("button", { name: "Mobile Tester" }).click();
    await page.getByRole("menuitem", { name: "Get the mobile app" }).click();
    const dialog = page.getByRole("dialog", {
      name: "OvertChat on your phone",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "Get it on App Store" }),
    ).toHaveAttribute(
      "href",
      "https://apps.apple.com/us/app/overtchat/id6812165221",
    );
    await dialog.getByRole("button", { name: "Android", exact: true }).click();
    await expect(
      dialog.getByRole("link", { name: "Get it on Google Play" }),
    ).toHaveAttribute(
      "href",
      "https://play.google.com/store/apps/details?id=com.overtchat.mobile",
    );
    await expect(
      dialog.getByRole("img", { name: "Google Play download QR code" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("download.png") });
    await dialog.getByRole("tab", { name: "Connect your phone" }).click();
    await expect(
      dialog.getByText("To use OvertChat on other devices", { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("img", { name: "Server connection QR code" }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(
      dialog.getByLabel("Server address", { exact: true }),
    ).toHaveText(baseURL!);
    await page.screenshot({
      path: testInfo.outputPath("connect-localhost.png"),
    });
    await dialog
      .getByRole("button", { name: "Close mobile app dialog" })
      .click();

    // Route a network hostname to the test server without external DNS or LAN access.
    const networkOrigin = baseURL!.replace("localhost", "chat.test");
    await page
      .context()
      .addCookies(
        (await page.context().cookies()).map((cookie) => ({
          ...cookie,
          domain: "chat.test",
        })),
      );
    await page.route(`${networkOrigin}/**`, async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace(networkOrigin, baseURL!),
      });
      await route.fulfill({ response });
    });
    await page.goto(networkOrigin);
    if (mobile)
      await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.getByRole("button", { name: "Mobile Tester" }).click();
    await page.getByRole("menuitem", { name: "Get the mobile app" }).click();
    await dialog.getByRole("tab", { name: "Connect your phone" }).click();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(
      dialog.getByLabel("Server address", { exact: true }),
    ).toHaveText(networkOrigin);
    await expect(
      dialog.getByRole("img", { name: "Server connection QR code" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Copy server address" }),
    ).toBeEnabled();
    await expect(
      dialog.getByText("To use OvertChat on other devices", { exact: false }),
    ).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("connect.png") });
    await dialog
      .getByRole("button", { name: "Close mobile app dialog" })
      .click();
    await expect(dialog).not.toBeVisible();
    if (mobile)
      await expect(
        page.getByRole("dialog", { name: "Navigation" }),
      ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(mobile ? 375 : 1280);
  });
}
