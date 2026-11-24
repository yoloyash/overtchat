import { createHash, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { MOBILE_SIGN_IN_REDIRECT, type NativeSignInExchange } from "@overtchat/shared";
import {
  base64Url,
  signInWithProvider,
  type ProviderSignInDevice,
} from "./providerSignIn";

const serverUrl = "https://chat.example.com";

function device(
  browser: (start: URL) => string | null,
  exchange: (grant: NativeSignInExchange) => boolean = () => true,
) {
  const grants: NativeSignInExchange[] = [];
  const opened: URL[] = [];
  const fake: ProviderSignInDevice = {
    randomBytes: (count) => new Uint8Array(randomBytes(count)),
    sha256: async (text) =>
      new Uint8Array(createHash("sha256").update(text).digest()),
    async openBrowser(url, redirectUri) {
      expect(redirectUri).toBe(MOBILE_SIGN_IN_REDIRECT);
      opened.push(new URL(url));
      return browser(new URL(url));
    },
    async exchange(grant) {
      grants.push(grant);
      return exchange(grant);
    },
  };
  return { fake, grants, opened };
}

const reply = (start: URL, params: Record<string, string>) =>
  `${MOBILE_SIGN_IN_REDIRECT}?${new URLSearchParams({
    state: start.searchParams.get("state")!,
    ...params,
  })}`;

it("encodes bytes as unpadded base64url", () => {
  for (const length of [0, 1, 2, 3, 31, 32, 48]) {
    const bytes = new Uint8Array(randomBytes(length));
    expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
  }
});

it("opens the server's sign-in and trades the code with its secret", async () => {
  const { fake, grants, opened } = device((start) => reply(start, { code: "one-time" }));

  expect(await signInWithProvider(serverUrl, fake)).toEqual({ ok: true });

  const [start] = opened;
  expect(start.origin + start.pathname).toBe(`${serverUrl}/api/native-sign-in/start`);
  expect(start.searchParams.get("redirect_uri")).toBe(MOBILE_SIGN_IN_REDIRECT);
  expect(start.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{16,128}$/u);
  expect(grants).toHaveLength(1);
  expect(grants[0].code).toBe("one-time");
  expect(
    createHash("sha256").update(grants[0].codeVerifier).digest("base64url"),
  ).toBe(start.searchParams.get("code_challenge"));
});

it("treats a closed browser as the user changing their mind", async () => {
  const { fake, grants } = device(() => null);

  expect(await signInWithProvider(serverUrl, fake)).toEqual({
    ok: false,
    error: "access_denied",
  });
  expect(grants).toEqual([]);
});

it("reports the server's refusal", async () => {
  const { fake, grants } = device((start) => reply(start, { error: "signup_disabled" }));

  expect(await signInWithProvider(serverUrl, fake)).toEqual({
    ok: false,
    error: "signup_disabled",
  });
  expect(grants).toEqual([]);
});

it("ignores a reply to a sign-in it didn't start", async () => {
  const { fake, grants } = device(
    () => `${MOBILE_SIGN_IN_REDIRECT}?state=someone-elses-state&code=stolen`,
  );

  expect(await signInWithProvider(serverUrl, fake)).toEqual({
    ok: false,
    error: "sign_in_failed",
  });
  expect(grants).toEqual([]);
});

it("reports a code the server no longer accepts", async () => {
  const { fake } = device((start) => reply(start, { code: "stale" }), () => false);

  expect(await signInWithProvider(serverUrl, fake)).toEqual({
    ok: false,
    error: "expired",
  });
});
