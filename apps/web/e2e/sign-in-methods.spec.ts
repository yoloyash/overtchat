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
    const button = login.getByRole("button", {
      name: `Continue with ${provider}`,
    });
    await expect(button).toBeEnabled();

    // Back from the provider's page, a browser may restore this one as it
    // was left, waiting; the button has to work again.
    await login.route("**/api/auth/sign-in/social", () => {});
    await button.click();
    const waiting = login.getByRole("button", {
      name: `Waiting for ${provider}…`,
    });
    await expect(waiting).toBeDisabled();
    await login.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await expect(button).toBeEnabled();
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
    // As after signing out; otherwise the page goes straight to the provider.
    await login.addInitScript(() =>
      sessionStorage.setItem("overtchat:signed-out", "1"),
    );
    await login.goto("/login");
    await expect(
      login.getByRole("button", { name: `Continue with ${provider}` }),
    ).toBeEnabled();
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

/**
 * The shell signs in through the default browser; here each attempt waits
 * until the test says how it ended.
 */
async function asDesktopApp(page: Page) {
  await page.addInitScript(() => {
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
}

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
    await asDesktopApp(login);
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

test("with passwords off, a browser goes straight to the provider", async ({
  browser,
  page,
}, testInfo) => {
  await createAdmin(page);
  const methods: SignInMethods = { password: false, sso: { name: provider } };
  const baseURL = String(testInfo.project.use.baseURL);
  const context = await browser.newContext({ baseURL });
  try {
    const login = await context.newPage();
    await serverReports(login, methods);
    // Stand-ins for the page someone came from and for the provider's own.
    await login.route("**/stand-in/*", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Elsewhere</h1>" }),
    );
    const starts: Array<Record<string, unknown>> = [];
    let providerAnswers = true;
    await login.route("**/api/auth/sign-in/social", async (route) => {
      starts.push(route.request().postDataJSON());
      await (providerAnswers
        ? route.fulfill({
            json: { url: `${baseURL}/stand-in/provider`, redirect: false },
          })
        : route.fulfill({
            status: 500,
            json: { code: "INTERNAL_SERVER_ERROR", message: "No provider" },
          }));
    });
    const button = login.getByRole("button", {
      name: `Continue with ${provider}`,
    });
    const alert = login.locator("form p[role=alert]");

    await login.goto("/stand-in/before");
    await login.goto("/login");
    await login.waitForURL("**/stand-in/provider");
    expect(starts).toEqual([
      expect.objectContaining({ provider: "oidc", disableRedirect: true }),
    ]);
    // The login page was never somewhere to come back to.
    await login.goBack();
    await login.waitForURL("**/stand-in/before");

    // A refused sign-in stays, or it would loop.
    await login.goto("/login?error=signup_disabled");
    await expect(alert).toContainText("doesn't have an OvertChat account");
    await expect(button).toBeEnabled();
    expect(starts).toHaveLength(1);

    // A provider the server can't reach leaves the button to try again.
    providerAnswers = false;
    await login.goto("/login");
    await expect(alert).toContainText(`Couldn't sign in with ${provider}.`);
    await expect(button).toBeEnabled();
    expect(starts).toHaveLength(2);

    // The desktop app would have to open another program, so it waits.
    const shell = await context.newPage();
    await asDesktopApp(shell);
    await serverReports(shell, methods);
    await shell.goto("/login");
    await expect(
      shell.getByRole("button", { name: `Continue with ${provider}` }),
    ).toBeEnabled();
    expect(
      await shell.evaluate(
        () => (window as unknown as DesktopWindow).__signInAttempts.length,
      ),
    ).toBe(0);
  } finally {
    await context.close();
  }

  // Signing out stays on the login page too, until the button is chosen.
  await serverReports(page, methods);
  const starts: unknown[] = [];
  await page.route("**/api/auth/sign-in/social", async (route) => {
    starts.push(route.request().postDataJSON());
    await route.fulfill({ status: 500, json: { code: "NO_PROVIDER" } });
  });
  await page.getByText("Sign-in Admin", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL("**/login");
  const again = page.getByRole("button", { name: `Continue with ${provider}` });
  await expect(again).toBeEnabled();
  await page.reload();
  await expect(again).toBeEnabled();
  expect(starts).toHaveLength(0);
  await again.click();
  await expect.poll(() => starts.length).toBe(1);
});
