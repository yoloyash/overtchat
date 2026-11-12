import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";
import { e2eGoogleOrigin, e2eGooglePort } from "./helpers/google";

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"];
const ALL_SCOPES = [...GMAIL_SCOPES, ...CALENDAR_SCOPES];

/**
 * Stands in for Google's token and revocation endpoints, and for the Gmail
 * and Calendar endpoints that name the account.
 */
let google: Server;
/** What Google grants, whatever the sign-in asked for. */
let grantedScopes = ALL_SCOPES;
let issued = 0;
const tokenRequests: Record<string, string>[] = [];
const revoked: string[] = [];

test.beforeAll(async () => {
  google = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const form = Object.fromEntries(
      new URLSearchParams(Buffer.concat(chunks).toString("utf8")),
    );
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/token") {
      tokenRequests.push(form);
      if (form.code !== "approved-code") {
        return json(400, { error: "invalid_grant" });
      }
      issued += 1;
      return json(200, {
        access_token: `access-${issued}`,
        expires_in: 3600,
        refresh_token: `refresh-${issued}`,
        scope: grantedScopes.join(" "),
        token_type: "Bearer",
      });
    }
    if (req.url === "/revoke") {
      revoked.push(form.token);
      return json(200, {});
    }
    if (req.url === "/gmail/v1/users/me/profile") {
      const account = req.headers.authorization?.replace("Bearer access-", "");
      return account
        ? json(200, { emailAddress: `inbox-${account}@example.test` })
        : json(401, {});
    }
    if (req.url === "/calendar/v3/calendars/primary") {
      const account = req.headers.authorization?.replace("Bearer access-", "");
      return account
        ? json(200, { id: `calendar-${account}@example.test` })
        : json(401, {});
    }
    json(404, {});
  });
  await new Promise<void>((resolve) =>
    google.listen(e2eGooglePort, "127.0.0.1", resolve),
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    google.close((error) => (error ? reject(error) : resolve())),
  );
});

test.beforeEach(() => {
  resetE2eDatabase();
  grantedScopes = ALL_SCOPES;
  issued = 0;
  tokenRequests.length = 0;
  revoked.length = 0;
});

async function signUpAdmin(page: Page) {
  await page.goto(await setupUrl());
  await page.locator("#name").fill("Connector Admin");
  await page.locator("#email").fill("connector-admin@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
}

function connectors(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Connectors", exact: true }) });
}

async function setUpGoogleAccess(page: Page) {
  await page.goto("/settings/tools");
  await connectors(page).getByRole("button", { name: "Set up" }).click();
  const dialog = page.getByRole("dialog", { name: "Google access" });
  await dialog.getByLabel("Client ID").fill("e2e-client.apps.googleusercontent.com");
  await dialog.getByLabel("Client secret").fill("e2e-client-secret");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

async function expectConnected(page: Page, account: string) {
  const row = connectors(page);
  await expect(row.getByText("Connected", { exact: true })).toBeVisible();
  await expect(row).toContainText(account);
}

/** Opens the connect dialog and returns the sign-in Google would be shown. */
async function startSignIn(page: Page) {
  await connectors(page)
    .getByRole("button", { name: /^(Connect|Reconnect)$/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect Google" });
  const link = dialog.getByRole("link", { name: "Open Google sign-in" });
  await expect(link).toHaveAttribute("href", /state=/);
  return { dialog, signIn: new URL((await link.getAttribute("href"))!) };
}

test("an administrator sets up Google access, then each person connects their own Gmail", async ({
  browser,
  page,
}, testInfo) => {
  await signUpAdmin(page);
  const created = await page.request.post("/api/auth/admin/create-user", {
    headers: { Origin: String(testInfo.project.use.baseURL) },
    data: {
      email: "connector-member@overtchat-test.local",
      name: "Connector Member",
      password: "test-password-123",
      role: "user",
    },
  });
  expect(created.status(), await created.text()).toBe(200);

  const memberContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  try {
    const member = await memberContext.newPage();
    await member.goto("/login");
    await member.locator("#email").fill("connector-member@overtchat-test.local");
    await member.locator("#password").fill("test-password-123");
    await member.getByRole("button", { name: "Sign in", exact: true }).click();
    await member.waitForURL("**/");

    // Until an administrator acts, nobody can connect and members cannot set it up.
    await member.goto("/settings/tools");
    await expect(connectors(member)).toContainText(
      "Not set up on this server. Ask an administrator to set up Google access.",
    );
    await expect(connectors(member).getByRole("button")).toHaveCount(0);
    expect(
      (await member.request.put("/api/integration-oauth-clients/google", {
        data: { clientId: "x", clientSecret: "y" },
      })).status(),
    ).toBe(403);
    expect(
      (await member.request.post("/api/integration-accounts/google/authorization", {
        data: { integrations: ["gmail"] },
      })).status(),
    ).toBe(409);

    await setUpGoogleAccess(page);
    await expect(connectors(page)).toContainText(
      "Sign in once to connect Gmail and Google Calendar.",
    );
    await expect(connectors(page).getByRole("listitem", { name: "Gmail" })).toContainText(
      "Let models search, read and organize your mail, and write emails for you to send.",
    );

    // The sign-in asks Google for a lasting grant on the loopback redirect.
    const { dialog, signIn } = await startSignIn(page);
    expect(signIn.origin).toBe(e2eGoogleOrigin);
    expect(signIn.pathname).toBe("/o/oauth2/v2/auth");
    expect(signIn.searchParams.get("client_id")).toBe(
      "e2e-client.apps.googleusercontent.com",
    );
    expect(signIn.searchParams.get("redirect_uri")).toBe("http://localhost:1");
    expect(signIn.searchParams.get("scope")).toBe(ALL_SCOPES.join(" "));
    expect(signIn.searchParams.get("access_type")).toBe("offline");
    expect(signIn.searchParams.has("login_hint")).toBe(false);
    const state = signIn.searchParams.get("state")!;
    await expect(dialog).toContainText(
      "If it says access is blocked, an administrator needs to add your Google address as a test user first.",
    );

    // An address from some other sign-in is refused without spending this one.
    await dialog
      .getByLabel("Address from your browser")
      .fill("http://localhost:1/?state=not-this-one&code=approved-code");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(dialog).toContainText("That address is from a different sign-in.");
    expect(tokenRequests).toHaveLength(0);

    await dialog
      .getByLabel("Address from your browser")
      .fill(`http://localhost:1/?state=${state}&code=approved-code&scope=x`);
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectConnected(page, "inbox-1@example.test");
    expect(tokenRequests[0]).toMatchObject({
      grant_type: "authorization_code",
      client_id: "e2e-client.apps.googleusercontent.com",
      client_secret: "e2e-client-secret",
      redirect_uri: "http://localhost:1",
    });
    expect(tokenRequests[0].code_verifier).toBeTruthy();

    // The connection survives a reload, and no token reaches the browser.
    await page.reload();
    await expectConnected(page, "inbox-1@example.test");
    const listed = await (await page.request.get("/api/integrations")).text();
    expect(listed).toContain("inbox-1@example.test");
    expect(listed).not.toMatch(/refresh-1|access-1|e2e-client-secret/);

    // The member has their own, separate connection and no administrator controls.
    await member.reload();
    await expect(
      connectors(member).getByRole("button", { name: "Google access settings" }),
    ).toHaveCount(0);
    // Pasting the whole address connects without another click.
    const memberSignIn = await startSignIn(member);
    await memberSignIn.dialog
      .getByLabel("Address from your browser")
      .evaluate((input, address) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text", address);
        input.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, `http://localhost:1/?state=${memberSignIn.signIn.searchParams.get("state")}&code=approved-code`);
    await expect(memberSignIn.dialog).toBeHidden();
    await expectConnected(member, "inbox-2@example.test");
    await expectConnected(page, "inbox-1@example.test");

    // Disconnecting withdraws only that person's grant.
    await connectors(page).getByRole("button", { name: "Disconnect" }).click();
    await expect(
      connectors(page).getByRole("button", { name: "Connect", exact: true }),
    ).toBeVisible();
    expect(revoked).toEqual(["refresh-1"]);
    await member.reload();
    await expectConnected(member, "inbox-2@example.test");

    // Removing Google access deletes what is left and closes the connector again.
    await connectors(page)
      .getByRole("button", { name: "Google access settings" })
      .click();
    const access = page.getByRole("dialog", { name: "Google access" });
    await expect(access.getByLabel("Client ID")).toHaveValue(
      "e2e-client.apps.googleusercontent.com",
    );
    await expect(access.getByLabel("Client secret")).toHaveValue("");
    await access.getByRole("button", { name: "Remove" }).click();
    await expect(access).toContainText("Everyone's Google connection");
    await access.getByRole("button", { name: "Remove" }).click();
    await expect(access).toBeHidden();
    await member.reload();
    await expect(connectors(member)).toContainText("Not set up on this server.");
  } finally {
    await memberContext.close();
  }
});

test("a sign-in that Google does not fully grant leaves nothing connected", async ({
  page,
}) => {
  await signUpAdmin(page);
  await setUpGoogleAccess(page);

  // Google granted less than was asked for.
  grantedScopes = ["https://www.googleapis.com/auth/gmail.readonly"];
  const first = await startSignIn(page);
  await first.dialog
    .getByLabel("Address from your browser")
    .fill(
      `http://localhost:1/?state=${first.signIn.searchParams.get("state")}&code=approved-code`,
    );
  await first.dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(first.dialog).toContainText(
    "Google did not grant the access OvertChat asked for. Start again and keep the checkboxes on Google's page ticked.",
  );
  expect(revoked).toEqual(["refresh-1"]);

  // That sign-in is spent; starting again issues a new one that works.
  grantedScopes = ALL_SCOPES;
  await first.dialog.getByRole("button", { name: "Start again" }).click();
  await expect(
    first.dialog.getByRole("link", { name: "Open Google sign-in" }),
  ).not.toHaveAttribute(
    "href",
    new RegExp(`state=${first.signIn.searchParams.get("state")}`),
  );
  const retry = new URL(
    (await first.dialog
      .getByRole("link", { name: "Open Google sign-in" })
      .getAttribute("href"))!,
  );
  await first.dialog
    .getByLabel("Address from your browser")
    .fill(
      `http://localhost:1/?state=${retry.searchParams.get("state")}&code=approved-code`,
    );
  await first.dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expectConnected(page, "inbox-2@example.test");
});

test("a sign-in Google has ended asks to be reconnected with the same account", async ({
  page,
}) => {
  await signUpAdmin(page);
  await setUpGoogleAccess(page);
  const { dialog, signIn } = await startSignIn(page);
  await dialog
    .getByLabel("Address from your browser")
    .fill(
      `http://localhost:1/?state=${signIn.searchParams.get("state")}&code=approved-code`,
    );
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expectConnected(page, "inbox-1@example.test");
  // What a refused refresh leaves behind once Google ends the sign-in.
  const db = openE2eDatabase();
  try {
    db.prepare(
      "UPDATE integration_accounts SET status = 'needs_reconnect'",
    ).run();
  } finally {
    db.close();
  }
  await page.reload();
  await expect(connectors(page)).toContainText(
    "Google ended access for inbox-1@example.test. Reconnect to keep using it.",
  );
  await expect(
    connectors(page).getByText("Sign-in ended", { exact: true }),
  ).toBeVisible();

  // Signing in again preselects the same account.
  const again = await startSignIn(page);
  expect(again.signIn.searchParams.get("login_hint")).toBe(
    "inbox-1@example.test",
  );
  await again.dialog
    .getByLabel("Address from your browser")
    .fill(
      `http://localhost:1/?state=${again.signIn.searchParams.get("state")}&code=approved-code`,
    );
  await again.dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expectConnected(page, "inbox-2@example.test");
  // The stand-in names a new account each time, and a different account's
  // earlier grant is withdrawn once the new one is stored.
  expect(revoked).toEqual(["refresh-1"]);
});

test("one sign-in covers what the person chooses, and is widened by signing in again", async ({
  page,
}) => {
  await signUpAdmin(page);
  await setUpGoogleAccess(page);
  const gmailRow = connectors(page).getByRole("listitem", { name: "Gmail" });
  const calendarRow = connectors(page).getByRole("listitem", {
    name: "Google Calendar",
  });
  const finish = async (signIn: Awaited<ReturnType<typeof startSignIn>>) => {
    const link = signIn.dialog.getByRole("link", { name: "Open Google sign-in" });
    await expect(link).toHaveAttribute("href", /state=/);
    const state = new URL((await link.getAttribute("href"))!).searchParams.get("state");
    await signIn.dialog
      .getByLabel("Address from your browser")
      .fill(`http://localhost:1/?state=${state}&code=approved-code`);
    await signIn.dialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(signIn.dialog).toBeHidden();
  };

  // Both are offered. Leaving Gmail out asks Google for the calendar alone.
  const first = await startSignIn(page);
  const gmailChoice = first.dialog.getByRole("switch", { name: "Gmail" });
  await expect(gmailChoice).toBeChecked();
  await expect(
    first.dialog.getByRole("switch", { name: "Google Calendar" }),
  ).toBeChecked();
  await gmailChoice.click();
  const link = first.dialog.getByRole("link", { name: "Open Google sign-in" });
  await expect(link).toHaveAttribute("href", /scope=[^&]*calendar(&|$)/);
  expect(
    new URL((await link.getAttribute("href"))!).searchParams.get("scope"),
  ).toBe(CALENDAR_SCOPES.join(" "));
  grantedScopes = CALENDAR_SCOPES;
  await finish(first);

  // Without Gmail, the calendar names the account.
  await expectConnected(page, "calendar-1@example.test");
  await expect(gmailRow).toContainText("Not part of this sign-in.");
  await expect(
    calendarRow
      .getByRole("radiogroup", { name: "Google Calendar tool access" })
      .getByRole("radio", { name: "On demand" }),
  ).toBeChecked();
  await expect(connectors(page).getByRole("radiogroup")).toHaveCount(1);

  // Adding Gmail signs in again for both, with the same account preselected.
  await gmailRow.getByRole("button", { name: "Add" }).click();
  const second = {
    dialog: page.getByRole("dialog", { name: "Connect Google" }),
    signIn: first.signIn,
  };
  await expect(second.dialog.getByRole("switch", { name: "Gmail" })).toBeChecked();
  await expect(
    second.dialog.getByRole("switch", { name: "Google Calendar" }),
  ).toBeChecked();
  const widened = second.dialog.getByRole("link", { name: "Open Google sign-in" });
  await expect(widened).toHaveAttribute("href", /login_hint=calendar-1/);
  expect(
    new URL((await widened.getAttribute("href"))!).searchParams.get("scope"),
  ).toBe(ALL_SCOPES.join(" "));
  grantedScopes = ALL_SCOPES;
  await finish(second);
  await expect(connectors(page).getByRole("radiogroup")).toHaveCount(2);

  // Each connector has its own tool access choice.
  const calendarAlways = calendarRow
    .getByRole("radiogroup", { name: "Google Calendar tool access" })
    .getByRole("radio", { name: "Always available" });
  await calendarAlways.click();
  await expect(calendarAlways).toBeChecked();
  await expect(
    gmailRow
      .getByRole("radiogroup", { name: "Gmail tool access" })
      .getByRole("radio", { name: "Always available" }),
  ).not.toBeChecked();
  const db = openE2eDatabase();
  try {
    expect(db.prepare("SELECT always_on FROM integration_accounts").get()).toEqual({
      always_on: '["calendar"]',
    });
  } finally {
    db.close();
  }

  // A permission left unticked on Google's page connects the rest, and says so.
  await connectors(page).getByRole("button", { name: "Change access" }).click();
  grantedScopes = GMAIL_SCOPES;
  await finish({
    dialog: page.getByRole("dialog", { name: "Connect Google" }),
    signIn: first.signIn,
  });
  await expect(
    page.getByText("Google Calendar was not allowed on Google's page. Change access to add it."),
  ).toBeVisible();
  await expect(calendarRow).toContainText("Not part of this sign-in.");
  await expect(
    gmailRow.getByRole("radiogroup", { name: "Gmail tool access" }),
  ).toBeVisible();
});
