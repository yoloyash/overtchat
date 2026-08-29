import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memories, userPersonalization } from "@/lib/db/schema";
import { memorySystemPrompt } from "@/lib/personalization/prompt";
import {
  MEMORY_CONTEXT_CHAR_LIMIT,
  MEMORY_ENTRY_LIMIT,
  type Memory,
  type MemoryInput,
  type Personalization,
  type PersonalizationInput,
  type PersonalizationSnapshot,
} from "@/lib/personalization/schema";

const DEFAULT_PERSONALIZATION: Personalization = {
  enabled: true,
  preferredName: null,
  occupation: null,
  about: null,
};

export class MemoryCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryCapacityError";
  }
}

export async function getPersonalization(
  userId: string,
): Promise<Personalization> {
  const [row] = await db
    .select({
      enabled: userPersonalization.enabled,
      preferredName: userPersonalization.preferredName,
      occupation: userPersonalization.occupation,
      about: userPersonalization.about,
    })
    .from(userPersonalization)
    .where(eq(userPersonalization.userId, userId))
    .limit(1);
  return row ?? DEFAULT_PERSONALIZATION;
}

export async function updatePersonalization(
  userId: string,
  input: PersonalizationInput,
): Promise<Personalization> {
  const [row] = await db
    .insert(userPersonalization)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: userPersonalization.userId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning({
      enabled: userPersonalization.enabled,
      preferredName: userPersonalization.preferredName,
      occupation: userPersonalization.occupation,
      about: userPersonalization.about,
    });
  return row;
}

export async function listMemories(userId: string): Promise<Memory[]> {
  const rows = await db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(asc(memories.createdAt), asc(memories.key));
  return rows.map(toMemory);
}

export async function getPersonalizationSnapshot(
  userId: string,
): Promise<PersonalizationSnapshot> {
  const [personalization, memoryRows] = await Promise.all([
    getPersonalization(userId),
    listMemories(userId),
  ]);
  return {
    personalization,
    memories: memoryRows,
    memoryUsage: usage(memoryRows),
  };
}

export function createMemory(
  userId: string,
  input: MemoryInput,
): Memory | "conflict" {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(asc(memories.createdAt), asc(memories.key))
      .all();
    if (current.some((memory) => memory.key === input.key)) return "conflict";
    assertCapacity([...current, candidate(input)]);
    const row = tx
      .insert(memories)
      .values({ id: crypto.randomUUID(), userId, ...input })
      .returning()
      .get();
    return toMemory(row);
  });
}

export function setMemory(userId: string, input: MemoryInput): Memory {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(asc(memories.createdAt), asc(memories.key))
      .all();
    const existing = current.find((memory) => memory.key === input.key);
    const prospective = existing
      ? current.map((memory) =>
          memory.id === existing.id
            ? { ...memory, value: input.value, updatedAt: new Date() }
            : memory,
        )
      : [...current, candidate(input)];
    assertCapacity(prospective);
    const now = new Date();
    const row = tx
      .insert(memories)
      .values({ id: crypto.randomUUID(), userId, ...input })
      .onConflictDoUpdate({
        target: [memories.userId, memories.key],
        set: { value: input.value, updatedAt: now },
      })
      .returning()
      .get();
    return toMemory(row);
  });
}

export function updateMemory(
  id: string,
  userId: string,
  input: MemoryInput,
): Memory | "not-found" | "conflict" {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(asc(memories.createdAt), asc(memories.key))
      .all();
    const existing = current.find((memory) => memory.id === id);
    if (!existing) return "not-found";
    if (
      current.some(
        (memory) => memory.id !== id && memory.key === input.key,
      )
    ) {
      return "conflict";
    }
    assertCapacity(
      current.map((memory) =>
        memory.id === id ? { ...memory, ...input, updatedAt: new Date() } : memory,
      ),
    );
    const row = tx
      .update(memories)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning()
      .get();
    return row ? toMemory(row) : "not-found";
  });
}

export async function deleteMemory(
  id: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

export async function deleteMemoryByKey(
  key: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(memories)
    .where(and(eq(memories.key, key), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

export async function clearMemories(userId: string): Promise<void> {
  await db.delete(memories).where(eq(memories.userId, userId));
}

function candidate(input: MemoryInput) {
  const now = new Date();
  return {
    id: "candidate",
    userId: "candidate",
    ...input,
    createdAt: now,
    updatedAt: now,
  };
}

function assertCapacity(rows: readonly { key: string; value: string }[]) {
  if (rows.length > MEMORY_ENTRY_LIMIT) {
    throw new MemoryCapacityError(
      `Memory is limited to ${MEMORY_ENTRY_LIMIT} entries.`,
    );
  }
  const characters = memorySystemPrompt(rows)?.length ?? 0;
  if (characters > MEMORY_CONTEXT_CHAR_LIMIT) {
    throw new MemoryCapacityError(
      `Memory context is limited to ${MEMORY_CONTEXT_CHAR_LIMIT.toLocaleString()} characters.`,
    );
  }
}

function usage(rows: readonly { key: string; value: string }[]) {
  return {
    characters: memorySystemPrompt(rows)?.length ?? 0,
    limit: MEMORY_CONTEXT_CHAR_LIMIT,
    entries: rows.length,
    entryLimit: MEMORY_ENTRY_LIMIT,
  };
}

function toMemory(row: typeof memories.$inferSelect): Memory {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
