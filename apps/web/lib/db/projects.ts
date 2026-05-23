import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, projects } from "@/lib/db/schema";

export type ProjectRow = typeof projects.$inferSelect;

export async function listProjects(userId: string): Promise<ProjectRow[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

export async function getProject(
  id: string,
  userId: string,
): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
}

function normalizeInstructions(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function createProject(
  userId: string,
  input: { name: string; instructions?: string | null },
): Promise<ProjectRow> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("name required");
  const [row] = await db
    .insert(projects)
    .values({
      id: crypto.randomUUID(),
      userId,
      name,
      instructions: normalizeInstructions(input.instructions),
    })
    .returning();
  return row;
}

export async function updateProject(
  id: string,
  userId: string,
  input: { name?: string; instructions?: string | null },
): Promise<ProjectRow | null> {
  const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 120);
    if (!name) return null;
    patch.name = name;
  }
  if (input.instructions !== undefined) {
    patch.instructions = normalizeInstructions(input.instructions);
  }
  const [row] = await db
    .update(projects)
    .set(patch)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteProject(id: string, userId: string): Promise<void> {
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

/**
 * Sets chats.project_id on a chat the caller owns. If projectId is non-null,
 * also verifies that project belongs to the caller. Returns true on success.
 */
export async function moveChatToProject(
  chatId: string,
  userId: string,
  projectId: string | null,
): Promise<boolean> {
  if (projectId !== null) {
    const project = await getProject(projectId, userId);
    if (!project) return false;
  }
  const res = await db
    .update(chats)
    .set({ projectId, updatedAt: new Date() })
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .returning({ id: chats.id });
  return res.length > 0;
}
