import type { SignInMethods, TwoFactorStatus } from "@overtchat/shared";
import { expect, test, type Page } from "@playwright/test";
import { resetE2eDatabase, setupUrl } from "./helpers/database";

test.beforeEach(resetE2eDatabase);

const provider = "Example ID";

/**
 * The test server has no identity provider, so the pages are shown what a
 * server with one reports. `lib/auth/oidc.test.ts` covers the sign-in itself.
 */
async function serverReports(page: Page, methods: SignInMethods) {
  await page.route("**/api/sign-in-methods", (route) =>
    route.fulfill({ json: methods }),
  );
}

async function createAdmin(page: Page) {
  await page.goto(await setupUrl());
  await page.getByLabel("Name").fill("Sign-in Admin");
  await page.getByLabel("Email").fill("sign-in-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
}

test("login offers the identity provider beside the password and explains a refusal", async ({
  browser,
  page,
}, testInfo) => {
  await createAdmin(page);
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const login = await context.newPage();
    await serverReports(login, { password: true, sso: { name: provider } });
    await login.goto("/login");
    await expect(login.getByLabel("Email")).toBeVisible();
    await expect(login.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(
      login.getByRole("button", { name: `Continue with ${provider}` }),
    ).toBeVisible();
    await expect(login.locator("form p[role=alert]")).toHaveCount(0);

    // Where the provider's callback sends someone without an account here.
    await login.goto("/login?error=signup_disabled");
    await expect(login.locator("form p[role=alert]")).toHaveText(
      `Your ${provider} account doesn't have an OvertChat account on this server. Ask your administrator to add you.`,
    );
    await expect(
      login.getByRole("button", { name: `Continue with ${provider}` }),
    ).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("a server without a provider keeps the password-only login", async ({
  browser,
  page,
}, testInfo) => {
  await createAdmin(page);
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const login = await context.newPage();
    await login.goto("/login?error=signup_disabled");
    await expect(login.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(
      login.getByRole("button", { name: /Continue with/u }),
    ).toHaveCount(0);
    await expect(login.locator("form p[role=alert]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("with passwords off, login and settings offer only the provider", async ({
  browser,
  page,
}, testInfo) => {
  await createAdmin(page);
  const methods: SignInMethods = { password: false, sso: { name: provider } };

  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const login = await context.newPage();
    await serverReports(login, methods);
    await login.goto("/login");
    await expect(
      login.getByRole("button", { name: `Continue with ${provider}` }),
    ).toBeVisible();
    await expect(login.getByLabel("Email")).toHaveCount(0);
    await expect(login.locator("#password")).toHaveCount(0);
    await expect(login.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    await expect(
      login.getByRole("button", { name: "Forgot password?" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }

  await serverReports(page, methods);
  await page.route("**/api/two-factor", (route) =>
    route.fulfill({
      json: {
        enabled: false,
        required: false,
        passwordSignIn: false,
      } satisfies TwoFactorStatus,
    }),
  );
  await page.goto("/settings/account");
  await expect(
    page.getByText(`You sign in with ${provider}.`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up" })).toHaveCount(0);
  await expect(page.locator("input[type=password]")).toHaveCount(0);

  const created = await page.request.post("/api/auth/admin/create-user", {
    headers: { Origin: String(testInfo.project.use.baseURL) },
    data: {
      email: "sign-in-member@overtchat-test.local",
      name: "Sign-in Member",
      role: "user",
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  await page.goto("/settings/users");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "sign-in-member@overtchat-test.local" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset password" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog", { name: "Add user" });
  await expect(dialog).toContainText(
    `They sign in with ${provider}, using this email address.`,
  );
  await expect(dialog.locator("input[type=password]")).toHaveCount(0);
  await dialog.getByLabel("Name").fill("Second Member");
  await dialog.getByLabel("Email").fill("second-member@overtchat-test.local");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "second-member@overtchat-test.local" }),
  ).toBeVisible();
});

type DesktopWindow = Window & {
  __signInAttempts: Array<
    (result: { ok: true } | { ok: false; error: string }) => void
  >;
};

test("the desktop app can start the provider sign-in again while one is waiting", async ({
  browser,
  page,
}, testInfo) => {
  await createAdmin(page);
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const login = await context.newPage();
    // The shell signs in through the default browser; here each attempt
    // waits until the test says how it ended.
    await login.addInitScript(() => {
      const attempts: DesktopWindow["__signInAttempts"] = [];
      Object.assign(window, {
        __signInAttempts: attempts,
        overtchatDesktop: {
          onCommand: () => () => {},
          changeServer: async () => {},
          getUpdateState: async () => null,
          onUpdateState: () => () => {},
          signInWithProvider: () =>
            new Promise((resolve) => attempts.push(resolve)),
        },
      });
    });
    await serverReports(login, { password: true, sso: { name: provider } });
    await login.goto("/login");
    const button = login.getByRole("button", {
      name: `Continue with ${provider}`,
    });
    const waiting = login.getByRole("status").filter({
      hasText: "Finish signing in in your browser.",
    });

    await button.click();
    await expect(waiting).toBeVisible();
    // The browser tab may have been closed: nothing here is locked.
    await expect(button).toBeEnabled();
    await expect(login.getByRole("button", { name: "Sign in" })).toBeEnabled();

    await button.click();
    await expect
      .poll(() =>
        login.evaluate(
          () => (window as unknown as DesktopWindow).__signInAttempts.length,
        ),
      )
      .toBe(2);
    // The shell ends the first attempt when the second starts.
    await login.evaluate(() =>
      (window as unknown as DesktopWindow).__signInAttempts[0]({
        ok: false,
        error: "access_denied",
      }),
    );
    await expect(waiting).toBeVisible();
    await expect(login.locator("form p[role=alert]")).toHaveCount(0);

    await login.evaluate(() =>
      (window as unknown as DesktopWindow).__signInAttempts[1]({
        ok: false,
        error: "signup_disabled",
      }),
    );
    await expect(login.locator("form p[role=alert]")).toContainText(
      `Your ${provider} account doesn't have an OvertChat account on this server.`,
    );
    await expect(waiting).toHaveCount(0);
  } finally {
    await context.close();
  }
});
