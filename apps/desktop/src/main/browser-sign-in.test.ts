import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { NativeSignInExchange } from "@overtchat/shared";
import { signInWithBrowser } from "./browser-sign-in";

const serverOrigin = "https://chat.example.com";

/** Starts a sign-in and captures the address the browser was sent to. */
function start(
  exchange: (grant: NativeSignInExchange) => Promise<boolean> = async () => true,
  timeoutMs?: number,
) {
  let opened!: (url: URL) => void;
  const browser = new Promise<URL>((resolve) => (opened = resolve));
  const result = signInWithBrowser({
    serverOrigin,
    openBrowser: (url) => opened(new URL(url)),
    exchange,
    timeoutMs,
  });
  return { browser, result };
}

function redirectFor(start: URL, params: Record<string, string>): string {
  const redirect = new URL(start.searchParams.get("redirect_uri")!);
  for (const [name, value] of Object.entries(params)) {
    redirect.searchParams.set(name, value);
  }
  return redirect.toString();
}

test("opens the server's sign-in with a loopback redirect and a challenge", async () => {
  const { browser, result } = start();
  const url = await browser;

  assert.equal(url.origin + url.pathname, `${serverOrigin}/api/native-sign-in/start`);
  assert.match(url.searchParams.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/sign-in$/u);
  assert.match(url.searchParams.get("code_challenge")!, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(url.searchParams.get("state")!, /^[A-Za-z0-9_-]{16,128}$/u);

  await fetch(redirectFor(url, { state: url.searchParams.get("state")!, error: "access_denied" }));
  assert.deepEqual(await result, { ok: false, error: "access_denied" });
});

test("trades the code with the secret behind the challenge", async () => {
  const grants: NativeSignInExchange[] = [];
  const { browser, result } = start(async (grant) => {
    grants.push(grant);
    return true;
  });
  const url = await browser;

  const page = await fetch(
    redirectFor(url, { state: url.searchParams.get("state")!, code: "one-time-code" }),
  );

  assert.match(await page.text(), /You're signed in/u);
  assert.deepEqual(await result, { ok: true });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].code, "one-time-code");
  assert.equal(
    createHash("sha256").update(grants[0].codeVerifier).digest("base64url"),
    url.searchParams.get("code_challenge"),
  );
});

test("ignores a redirect it didn't ask for", async () => {
  let exchanged = false;
  const { browser, result } = start(async () => (exchanged = true));
  const url = await browser;

  const stray = await fetch(redirectFor(url, { state: "someone-elses-state", code: "code" }));
  assert.equal(stray.status, 404);
  assert.equal(exchanged, false);

  // The real redirect still works afterwards.
  await fetch(redirectFor(url, { state: url.searchParams.get("state")!, code: "code" }));
  assert.deepEqual(await result, { ok: true });
});

test("reports the server's refusal", async () => {
  const { browser, result } = start();
  const url = await browser;

  const page = await fetch(
    redirectFor(url, { state: url.searchParams.get("state")!, error: "signup_disabled" }),
  );

  assert.match(await page.text(), /didn't finish/u);
  assert.deepEqual(await result, { ok: false, error: "signup_disabled" });
});

test("reports a code the server no longer accepts", async () => {
  const { browser, result } = start(async () => false);
  const url = await browser;

  await fetch(redirectFor(url, { state: url.searchParams.get("state")!, code: "stale" }));

  assert.deepEqual(await result, { ok: false, error: "expired" });
});

test("stops listening once the sign-in ends", async () => {
  const { browser, result } = start();
  const url = await browser;
  const redirect = redirectFor(url, { state: url.searchParams.get("state")!, code: "code" });
  await fetch(redirect);
  await result;

  await assert.rejects(fetch(redirect));
});

test("starting again abandons the sign-in before", async () => {
  const first = start();
  await first.browser;
  const second = start();
  const url = await second.browser;

  assert.deepEqual(await first.result, { ok: false, error: "access_denied" });

  await fetch(redirectFor(url, { state: url.searchParams.get("state")!, code: "code" }));
  assert.deepEqual(await second.result, { ok: true });
});

test("gives up when the browser never comes back", async () => {
  const { browser, result } = start(undefined, 50);
  await browser;

  assert.deepEqual(await result, { ok: false, error: "expired" });
});
