import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, projectFiles, projects, uploads } from "@/lib/db/schema";
import type { ChatFile } from "@/lib/chat/chat-files";
import { MAX_PROJECT_FILES, type ProjectFileItem } from "@/lib/project-files";

export type AddProjectFileResult =
  | { ok: true; file: ProjectFileItem; created: boolean }
  | { ok: false; reason: "project-not-found" | "upload-not-found" | "image" | "limit" };

const selection = {
  uploadId: uploads.id,
  filename: uploads.filename,
  mediaType: uploads.mediaType,
  category: uploads.category,
  size: uploads.size,
  pageCount: uploads.pageCount,
  truncated: uploads.truncated,
  addedAt: projectFiles.createdAt,
  sourceChatId: projectFiles.sourceChatId,
  sourceChatTitle: chats.title,
};

type Row = {
  uploadId: string;
  filename: string;
  mediaType: string;
  category: "image" | "document" | "text" | "spreadsheet";
  size: number;
  pageCount: number | null;
  truncated: boolean;
  addedAt: Date;
  sourceChatId: string | null;
  sourceChatTitle: string | null;
};

function toItem(row: Row): ProjectFileItem {
  return {
    uploadId: row.uploadId,
    url: `/api/uploads/${row.uploadId}`,
    filename: row.filename,
    mediaType: row.mediaType,
    category: row.category === "image" ? "text" : row.category,
    size: row.size,
    pageCount: row.pageCount,
    truncated: row.truncated,
    addedAt: row.addedAt.getTime(),
    sourceChat: row.sourceChatId
      ? { id: row.sourceChatId, title: row.sourceChatTitle }
      : null,
  };
}

/** Files of a project the caller owns, oldest first; empty for other users. */
export async function listProjectFiles(
  projectId: string,
  userId: string,
): Promise<ProjectFileItem[]> {
  const rows = await db
    .select(selection)
    .from(projectFiles)
    .innerJoin(projects, eq(projects.id, projectFiles.projectId))
    .innerJoin(uploads, eq(uploads.id, projectFiles.uploadId))
    .leftJoin(chats, eq(chats.id, projectFiles.sourceChatId))
    .where(and(eq(projectFiles.projectId, projectId), eq(projects.userId, userId)))
    .orderBy(asc(projectFiles.createdAt), asc(uploads.id));
  return rows.map(toItem);
}

/**
 * The project's files as conversation files, in the order they were added.
 * Names are the stored filenames; `listChatFiles` makes them unique.
 */
export async function listProjectChatFiles(
  projectId: string,
  userId: string,
): Promise<ChatFile[]> {
  const items = await listProjectFiles(projectId, userId);
  return items.map((item) => ({
    uploadId: item.uploadId,
    name: item.filename,
    mediaType: item.mediaType,
  }));
}

/**
 * Links an upload the caller owns to a project the caller owns. Adding a file
 * that is already in the project succeeds without change. Images are not
 * reference material: the file tools read text.
 */
export async function addProjectFile(input: {
  projectId: string;
  userId: string;
  uploadId: string;
  sourceChatId?: string | null;
}): Promise<AddProjectFileResult> {
  return db.transaction((tx) => {
    const project = tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)))
      .get();
    if (!project) return { ok: false, reason: "project-not-found" } as const;
    const upload = tx
      .select({ id: uploads.id, category: uploads.category })
      .from(uploads)
      .where(and(eq(uploads.id, input.uploadId), eq(uploads.userId, input.userId)))
      .get();
    if (!upload) return { ok: false, reason: "upload-not-found" } as const;
    if (upload.category === "image") return { ok: false, reason: "image" } as const;

    const sourceChat = input.sourceChatId
      ? tx
          .select({ id: chats.id })
          .from(chats)
          .where(and(eq(chats.id, input.sourceChatId), eq(chats.userId, input.userId)))
          .get()
      : null;

    const existing = tx
      .select({ uploadId: projectFiles.uploadId })
      .from(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, input.projectId),
          eq(projectFiles.uploadId, input.uploadId),
        ),
      )
      .get();
    if (!existing) {
      const [{ count }] = tx
        .select({ count: sql<number>`count(*)` })
        .from(projectFiles)
        .where(eq(projectFiles.projectId, input.projectId))
        .all();
      if (count >= MAX_PROJECT_FILES) return { ok: false, reason: "limit" } as const;
      tx.insert(projectFiles)
        .values({
          projectId: input.projectId,
          uploadId: input.uploadId,
          sourceChatId: sourceChat?.id ?? null,
        })
        .run();
      tx.update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, input.projectId))
        .run();
    }
    const row = tx
      .select(selection)
      .from(projectFiles)
      .innerJoin(uploads, eq(uploads.id, projectFiles.uploadId))
      .leftJoin(chats, eq(chats.id, projectFiles.sourceChatId))
      .where(
        and(
          eq(projectFiles.projectId, input.projectId),
          eq(projectFiles.uploadId, input.uploadId),
        ),
      )
      .get()!;
    return { ok: true, file: toItem(row), created: !existing } as const;
  }, { behavior: "immediate" });
}

/**
 * Unlinks a file from a project the caller owns. The upload stays until the
 * orphan sweep finds nothing else referencing it. Returns false when there
 * was no such link.
 */
export async function removeProjectFile(
  projectId: string,
  userId: string,
  uploadId: string,
): Promise<boolean> {
  return db.transaction((tx) => {
    const project = tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .get();
    if (!project) return false;
    const removed =
      tx
        .delete(projectFiles)
        .where(
          and(eq(projectFiles.projectId, projectId), eq(projectFiles.uploadId, uploadId)),
        )
        .run().changes > 0;
    if (removed) {
      tx.update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, projectId))
        .run();
    }
    return removed;
  }, { behavior: "immediate" });
}
