import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type {
  SignInApprovalState,
  SignInDecision,
  SignInDecisionResult,
  SignInRequest,
} from "@overtchat/shared";
import { db } from "@/lib/db/client";
import { session, signInApprovals } from "@/lib/db/schema";

/** How long a request waits for approval; the one-time code expires with it. */
export const SIGN_IN_APPROVAL_MINUTES = 5;
/** Requests a user's pending sign-ins may send per window, to stop push spam. */
export const SIGN_IN_REQUEST_LIMIT = 5;
export const SIGN_IN_REQUEST_WINDOW_MS = 10 * 60_000;
const RETAIN_MS = 24 * 60 * 60_000;

/**
 * Pending sign-ins are identified by their signed cookie. Only its hash is
 * stored, so the table can't be used to resume someone else's sign-in.
 */
export function challengeKey(cookie: string): string {
  return createHash("sha256").update(cookie).digest("base64url");
}

/** Three distinct two-digit numbers, one of which is `number`. */
function numberChoices(number: number): number[] {
  const choices = [number];
  while (choices.length < 3) {
    const candidate = randomInt(10, 100);
    if (!choices.includes(candidate)) choices.push(candidate);
  }
  for (let i = choices.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

/** Whether the user has a login that could approve a sign-in. */
export function hasSignInApprover(userId: string, now = new Date()): boolean {
  return Boolean(
    db
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          eq(session.userId, userId),
          gt(session.expiresAt, now),
          isNull(session.impersonatedBy),
        ),
      )
      .get(),
  );
}

/** Requests the user's pending sign-ins sent within the rate-limit window. */
export function recentSignInRequests(userId: string, now = new Date()): number {
  return db
    .select({ id: signInApprovals.id })
    .from(signInApprovals)
    .where(
      and(
        eq(signInApprovals.userId, userId),
        gt(
          signInApprovals.createdAt,
          new Date(now.getTime() - SIGN_IN_REQUEST_WINDOW_MS),
        ),
      ),
    )
    .all().length;
}

/**
 * Records a request for the pending sign-in, replacing an earlier one from the
 * same sign-in. Requests are kept for a day after they expire so the rate
 * limit still counts them.
 */
export function createSignInApproval(input: {
  userId: string;
  challenge: string;
  code: string;
  device: string;
  ipAddress: string | null;
  now?: Date;
}): { id: string; number: number; expiresAt: Date } {
  const now = input.now ?? new Date();
  const number = randomInt(10, 100);
  const row = {
    id: randomUUID(),
    userId: input.userId,
    challenge: input.challenge,
    code: input.code,
    number,
    choices: numberChoices(number),
    device: input.device,
    ipAddress: input.ipAddress,
    status: "pending" as const,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SIGN_IN_APPROVAL_MINUTES * 60_000),
  };
  db.transaction((tx) => {
    tx.delete(signInApprovals)
      .where(
        or(
          lt(signInApprovals.expiresAt, new Date(now.getTime() - RETAIN_MS)),
          eq(signInApprovals.challenge, input.challenge),
        ),
      )
      .run();
    tx.insert(signInApprovals).values(row).run();
  });
  return { id: row.id, number, expiresAt: row.expiresAt };
}

/** What the signing-in device is told about its request. */
export function signInApprovalState(
  challenge: string,
  now = new Date(),
): SignInApprovalState {
  const row = db
    .select()
    .from(signInApprovals)
    .where(eq(signInApprovals.challenge, challenge))
    .get();
  if (!row || row.expiresAt <= now) return { status: "expired" };
  if (row.status === "pending") {
    return {
      status: "pending",
      number: row.number,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
  if (row.status === "approved" && row.code) {
    return { status: "approved", code: row.code };
  }
  return { status: row.status === "approved" ? "expired" : row.status };
}

/** The sign-in finished; its request and code are no longer needed. */
export function finishSignInApproval(challenge: string) {
  db.delete(signInApprovals)
    .where(eq(signInApprovals.challenge, challenge))
    .run();
}

/** Requests waiting for the user to approve or deny them, newest first. */
export function pendingSignInRequests(
  userId: string,
  now = new Date(),
): SignInRequest[] {
  return db
    .select()
    .from(signInApprovals)
    .where(
      and(
        eq(signInApprovals.userId, userId),
        eq(signInApprovals.status, "pending"),
        gt(signInApprovals.expiresAt, now),
      ),
    )
    .orderBy(desc(signInApprovals.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      device: row.device,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      choices: row.choices,
    }));
}

/**
 * Applies a signed-in device's answer. Picking the wrong number blocks the
 * sign-in, so approving by guessing fails two times in three.
 */
export function decideSignInRequest(input: {
  id: string;
  userId: string;
  sessionId: string;
  decision: SignInDecision;
  now?: Date;
}): SignInDecisionResult | "not_found" {
  const now = input.now ?? new Date();
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(signInApprovals)
      .where(
        and(
          eq(signInApprovals.id, input.id),
          eq(signInApprovals.userId, input.userId),
        ),
      )
      .get();
    if (!row) return "not_found";
    if (row.status !== "pending" || row.expiresAt <= now) return "expired";
    const status = !input.decision.approve
      ? "denied"
      : input.decision.number === row.number
        ? "approved"
        : "mismatch";
    tx.update(signInApprovals)
      .set({
        status,
        decidedBySessionId: input.sessionId,
        ...(status === "approved" ? {} : { code: null }),
      })
      .where(eq(signInApprovals.id, row.id))
      .run();
    return status;
  });
}

