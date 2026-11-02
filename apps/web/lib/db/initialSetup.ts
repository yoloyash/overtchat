import "server-only";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { account, hostConnectors, initialSetup, user } from "./schema";

// Deriving from a private server secret lets the CLI retrieve the same code after
// a restart without storing the code itself. Discarding the nonce consumes it.
function deriveCode(nonce: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for initial setup.");
  const digest = createHmac("sha256", secret)
    .update(`overtchat-initial-setup-v1:${nonce}`)
    .digest();
  // Twelve Crockford Base32 characters give 60 bits, grouped for manual entry.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const code = [...digest.subarray(0, 12)]
    .map((byte) => alphabet[byte & 31])
    .join("");
  return code.match(/.{4}/g)!.join("-");
}

export function getSetupCode(): string | null {
  return db.transaction((tx) => {
    const hasUsers = !!tx.select({ id: user.id }).from(user).limit(1).get();
    tx.insert(initialSetup)
      .values({ id: 1, nonce: hasUsers ? null : randomBytes(32).toString("hex") })
      .onConflictDoNothing()
      .run();
    // Also closes setup for installations that predate the setup-code flow.
    if (hasUsers) {
      tx.update(initialSetup)
        .set({ nonce: null })
        .where(eq(initialSetup.id, 1))
        .run();
      return null;
    }
    const state = tx.select().from(initialSetup)
      .where(eq(initialSetup.id, 1)).get()!;
    return state.nonce ? deriveCode(state.nonce) : null;
  }, { behavior: "immediate" });
}

export function setupCodeMatches(actual: string): boolean {
  const expected = getSetupCode();
  if (!expected) return false;
  const normalized = actual.toUpperCase().replace(/[\s-]/g, "");
  const a = Buffer.from(normalized);
  const b = Buffer.from(expected.replaceAll("-", ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Password hashing happens before this synchronous, all-or-nothing claim. */
export function createInitialAdmin(input: {
  code: string;
  name: string;
  email: string;
  passwordHash: string;
}) {
  return db.transaction((tx) => {
    if (!setupCodeMatches(input.code)) return null;
    const now = new Date();
    const created = tx.insert(user)
      .values({
        id: randomUUID(),
        name: input.name,
        email: input.email,
        emailVerified: false,
        role: "admin",
        createdAt: now,
        updatedAt: now,
      }).returning().get();
    tx.insert(account)
      .values({
        id: randomUUID(),
        userId: created.id,
        accountId: created.id,
        providerId: "credential",
        password: input.passwordHash,
        createdAt: now,
        updatedAt: now,
      }).run();
    tx.update(hostConnectors)
      .set({ userId: created.id, updatedAt: now })
      .where(and(eq(hostConnectors.managed, true), isNull(hostConnectors.userId)))
      .run();
    tx.update(initialSetup)
      .set({ nonce: null })
      .where(eq(initialSetup.id, 1))
      .run();
    return created;
  }, { behavior: "immediate" });
}
