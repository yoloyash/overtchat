import assert from "node:assert/strict";
import test from "node:test";
import { needsTwoFactorCookie, pendingTwoFactorCookie } from "./two-factor-cookie";

test("keeps the pending sign-in cookie from Set-Cookie headers", () => {
  assert.equal(
    pendingTwoFactorCookie([
      "better-auth.session_token=; Max-Age=0; Path=/",
      "better-auth.two_factor=abc.def; Max-Age=600; Path=/; HttpOnly; SameSite=Lax",
    ]),
    "better-auth.two_factor=abc.def",
  );
  assert.equal(
    pendingTwoFactorCookie(["__Secure-better-auth.two_factor=abc; Max-Age=600; Secure"]),
    "__Secure-better-auth.two_factor=abc",
  );
});

test("clears the cookie when the server expires it", () => {
  assert.equal(pendingTwoFactorCookie(["better-auth.two_factor=; Max-Age=0; Path=/"]), null);
  assert.equal(pendingTwoFactorCookie(["better-auth.two_factor=abc; Max-Age=0"]), null);
});

test("leaves the cookie alone when the response doesn't mention it", () => {
  assert.equal(pendingTwoFactorCookie([]), undefined);
  assert.equal(pendingTwoFactorCookie(["better-auth.session_token=xyz; Path=/"]), undefined);
});

test("sends it only with two-factor requests", () => {
  assert.equal(needsTwoFactorCookie("/api/auth/two-factor/verify-totp"), true);
  // Approving on another device sends, waits for, and verifies a one-time code.
  assert.equal(needsTwoFactorCookie("/api/auth/two-factor/send-otp"), true);
  assert.equal(needsTwoFactorCookie("/api/auth/two-factor/approval"), true);
  assert.equal(needsTwoFactorCookie("/api/auth/two-factor/verify-otp"), true);
  assert.equal(needsTwoFactorCookie("/api/sign-in-requests"), false);
  assert.equal(needsTwoFactorCookie("/api/auth/get-session"), false);
  assert.equal(needsTwoFactorCookie("/api/chats"), false);
});
