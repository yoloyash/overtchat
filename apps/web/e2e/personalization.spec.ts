import { expect, test } from "@playwright/test";
import {
  openE2eDatabase,
  resetE2eDatabase,
} from "./helpers/database";

test.beforeEach(resetE2eDatabase);

test("save a private profile and manage memory", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Memory Tester");
  await page.getByLabel("Email").fill("memory@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  await page.goto("/settings/personalization");
  await expect(
    page.getByRole("heading", { name: "Personalization", exact: true }),
  ).toBeVisible();

  const profileForm = page.locator("form").filter({
    has: page.getByLabel("Preferred name"),
  });
  await page.getByLabel("Preferred name").fill("Boomer");
  await page.getByLabel("Occupation").fill("Software engineer");
  await page
    .getByLabel("More about you")
    .fill("Likes simple systems and concise answers.");
  await profileForm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Personalization saved")).toBeVisible();

  await page.getByRole("button", { name: "Add memory" }).click();
  await page.getByLabel("Memory value").fill("Prefer concise answers.");
  await page.getByLabel("Memory key").fill("response_style");
  await page.getByRole("button", { name: "Add memory" }).last().click();
  await expect(page.getByText("Memory added")).toBeVisible();
  await expect(page.getByText("Prefer concise answers.")).toBeVisible();
  await expect(page.getByText("response_style")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Preferred name")).toHaveValue("Boomer");
  await expect(page.getByText("Prefer concise answers.")).toBeVisible();

  await page.getByRole("button", { name: "Edit response_style" }).click();
  await page
    .getByLabel("Memory value")
    .fill("Prefer concise and direct answers.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Memory updated")).toBeVisible();
  await expect(page.getByText("Prefer concise and direct answers.")).toBeVisible();

  await page.getByRole("switch", { name: "Use personalization" }).click();
  await profileForm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Personalization saved")).toBeVisible();

  const db = openE2eDatabase();
  try {
    expect(
      db
        .prepare(
          `SELECT up.enabled, up.preferred_name AS preferredName,
                  up.occupation, up.about
             FROM user_personalization up
             JOIN user u ON u.id = up.user_id
            WHERE u.email = ?`,
        )
        .get("memory@overtchat-test.local"),
    ).toEqual({
      enabled: 0,
      preferredName: "Boomer",
      occupation: "Software engineer",
      about: "Likes simple systems and concise answers.",
    });
    expect(
      db
        .prepare(
          `SELECT m.key, m.value
             FROM memories m
             JOIN user u ON u.id = m.user_id
            WHERE u.email = ?`,
        )
        .get("memory@overtchat-test.local"),
    ).toEqual({
      key: "response_style",
      value: "Prefer concise and direct answers.",
    });
  } finally {
    db.close();
  }
});
