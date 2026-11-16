import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, like, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { verification } from "@/lib/db/schema";

/** How long the browser has to finish signing in at the provider. */
export const NATIVE_SIGN_IN_REQUEST_MS = 10 * 60_000;
/** How long the app has to trade its code; it does so as soon as it arrives. */
export const NATIVE_SIGN_IN_CODE_MS = 2 * 60_000;

const REQUEST_PREFIX = "native-sign-in-request:";
const CODE_PREFIX = "native-sign-in-code:";

/** An app's sign-in while the browser is at the identity provider. */
export interface NativeSignInRequest {
  redirectUri: string;
  codeChallenge: string;
  state: string;
  /** The browser was signed in to this server before the app's sign-in began. */
  browserSignedIn: boolean;
  startedAt: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function store(identifier: string, value: unknown, ttlMs: number, now: Date) {
  // Abandoned sign-ins leave rows behind; nothing else reads them.
  db.delete(verification)
    .where(
      and(
        like(verification.identifier, "native-sign-in-%"),
        lt(verification.expiresAt, now),
      ),
    )
    .run();
  db.insert(verification)
    .values({
      id: randomUUID(),
      identifier,
      value: JSON.stringify(value),
      expiresAt: new Date(now.getTime() + ttlMs),
    })
    .run();
}

/** Removes the row as it reads it, so a request or code works only once. */
function take<T>(identifier: string, now: Date): T | null {
  const row = db
    .delete(verification)
    .where(eq(verification.identifier, identifier))
    .returning()
    .get();
  if (!row || row.expiresAt <= now) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

/** Remembers an app's sign-in and returns the ID the browser comes back with. */
export function createNativeSignInRequest(
  request: Omit<NativeSignInRequest, "startedAt">,
  now = new Date(),
): string {
  const id = randomBytes(32).toString("base64url");
  store(
    REQUEST_PREFIX + sha256(id),
    { ...request, startedAt: now.getTime() } satisfies NativeSignInRequest,
    NATIVE_SIGN_IN_REQUEST_MS,
    now,
  );
  return id;
}

export function takeNativeSignInRequest(
  id: string,
  now = new Date(),
): NativeSignInRequest | null {
  return take<NativeSignInRequest>(REQUEST_PREFIX + sha256(id), now);
}

/**
 * Issues the one-time code the browser carries back to the app. Only its hash
 * is stored, with the challenge the app must answer to use it.
 */
export function createNativeSignInCode(
  grant: { userId: string; codeChallenge: string },
  now = new Date(),
): string {
  const code = randomBytes(32).toString("base64url");
  store(CODE_PREFIX + sha256(code), grant, NATIVE_SIGN_IN_CODE_MS, now);
  return code;
}

/**
 * The user a code signs in, if the caller holds the secret the sign-in began
 * with. A wrong secret still spends the code.
 */
export function redeemNativeSignInCode(
  code: string,
  codeVerifier: string,
  now = new Date(),
): string | null {
  const grant = take<{ userId: string; codeChallenge: string }>(
    CODE_PREFIX + sha256(code),
    now,
  );
  if (!grant) return null;
  const expected = Buffer.from(grant.codeChallenge);
  const actual = Buffer.from(sha256(codeVerifier));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  return grant.userId;
}
