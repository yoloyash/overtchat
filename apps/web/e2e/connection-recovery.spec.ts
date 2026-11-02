import { expect, test } from "@playwright/test";

for (const failure of [
  { name: "initial session", path: "/", endpoint: "/api/auth/get-session" },
  { name: "login session", path: "/login", endpoint: "/api/auth/get-session" },
  { name: "login setup", path: "/login", endpoint: "/api/setup" },
  { name: "signup setup", path: "/signup", endpoint: "/api/setup" },
]) {
  test(`${failure.name} failure offers recovery and retry loads the page`, async ({ page }) => {
    let unavailable = true;
    await page.route("**/api/auth/get-session*", (route) => failure.endpoint.endsWith("get-session") && unavailable
      ? route.abort("failed") : route.fulfill({ json: null }));
    await page.route("**/api/setup", (route) => failure.endpoint.endsWith("setup") && unavailable
      ? route.abort("failed") : route.fulfill({ json: { required: failure.path === "/signup" } }));
    await page.goto(failure.path);
    await expect(page.getByRole("heading", { name: "Couldn't load OvertChat" })).toBeVisible({ timeout: 20_000 });
    // Browser users can retry without being offered a desktop-only operation.
    await expect(page.getByRole("button", { name: "Change server", exact: true })).toHaveCount(0);
    unavailable = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", {
      name: failure.path === "/signup" ? "Create the first account" : "Welcome back",
    })).toBeVisible();
  });
}

test("desktop recovery remains available if changing servers fails", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      overtchatDesktop: {
        async changeServer() { throw new Error("IPC unavailable"); },
      },
    });
  });
  await page.route("**/api/auth/get-session*", (route) => route.abort("failed"));
  await page.goto("/");
  const change = page.getByRole("button", { name: "Change server", exact: true });
  await expect(change).toBeVisible({ timeout: 20_000 });
  await change.click();
  await expect(page.getByRole("region", { name: "Couldn't load OvertChat" }).getByRole("alert"))
    .toHaveText("Couldn't change servers. Try again or restart the app.");
  await expect(change).toBeEnabled();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
});
