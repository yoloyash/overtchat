import { createAuthClient } from "better-auth/client";
import { describe, expect, it, vi } from "vitest";
import {
  isSessionPayload,
  sessionResponseGuard,
  unexpectedSessionMessage,
} from "./sessionResponseGuard";

const signedIn = {
  session: { id: "session-1", userId: "user-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  user: { id: "user-1", email: "a@example.com" },
};

function html() {
  return new Response("<!doctype html><title>Sign in</title>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function client(respond: (url: string) => Response) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => respond(String(input)));
  return createAuthClient({
    baseURL: "https://chat.example",
    plugins: [sessionResponseGuard()],
    fetchOptions: { customFetchImpl: fetchImpl as typeof fetch },
  });
}

describe("isSessionPayload", () => {
  it.each([
    ["signed out", null, true],
    ["cleared session", { session: null, user: null }, true],
    ["session with user", signedIn, true],
    ["HTML text", "<html></html>", false],
    ["empty object", {}, false],
    ["session without user", { session: signedIn.session }, false],
    ["user without id", { session: signedIn.session, user: {} }, false],
    ["undefined", undefined, false],
  ])("%s", (_name, value, expected) => {
    expect(isSessionPayload(value)).toBe(expected);
  });
});

describe("sessionResponseGuard", () => {
  it("turns a page of HTML into a failed session check", async () => {
    const result = await client(html).getSession();

    expect(result.data).toBeNull();
    expect(result.error?.status).toBe(502);
    expect(unexpectedSessionMessage(result.error)).toMatch(/proxy or Wi-Fi sign-in page/);
  });

  it("rejects JSON that isn't a session", async () => {
    const result = await client(() => json({ ok: true })).getSession();

    expect(result.data).toBeNull();
    expect(result.error?.status).toBe(502);
  });

  it("passes sessions and signed-out answers through", async () => {
    const signedInResult = await client(() => json(signedIn)).getSession();
    expect(signedInResult.error).toBeNull();
    expect(signedInResult.data?.user.id).toBe("user-1");

    const signedOutResult = await client(() => json(null)).getSession();
    expect(signedOutResult.error).toBeNull();
    expect(signedOutResult.data).toBeNull();
  });

  it("leaves other endpoints and error responses alone", async () => {
    const other = await client(html).$fetch("/ok");
    expect(other.error).toBeNull();
    expect(other.data).toMatch(/<title>Sign in<\/title>/);

    const unauthorized = await client(
      () => new Response("{}", { status: 401, headers: { "content-type": "application/json" } }),
    ).getSession();
    expect(unauthorized.error?.status).toBe(401);
    expect(unexpectedSessionMessage(unauthorized.error)).toBeNull();
  });

  it("keeps the last good session when a later check returns HTML", async () => {
    let page = false;
    const auth = client(() => (page ? html() : json(signedIn)));
    const atom = auth.$store.atoms.session;
    const stop = atom.listen(() => {});
    try {
      await atom.get().refetch();
      expect(atom.get().data?.user.id).toBe("user-1");

      page = true;
      await atom.get().refetch();
      expect(atom.get().data?.user.id).toBe("user-1");
      expect(unexpectedSessionMessage(atom.get().error)).not.toBeNull();
    } finally {
      stop();
    }
  });
});
