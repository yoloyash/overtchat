import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, messages, uploads } from "@/lib/db/schema";
import type { LibraryCursor, LibraryPage } from "@/lib/library";

const PAGE_SIZE = 40;

/** Library membership follows saved user attachments, independently of cleanup. */
export async function listLibrary(
  userId: string,
  query = "",
  cursor?: LibraryCursor,
): Promise<LibraryPage> {
  const rows = await db
    .select({
      id: uploads.id,
      filename: uploads.filename,
      mediaType: uploads.mediaType,
      category: uploads.category,
      size: uploads.size,
      pageCount: uploads.pageCount,
      truncated: uploads.truncated,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .where(and(
      eq(uploads.userId, userId),
      cursor ? sql`(${uploads.createdAt}, ${uploads.id}) < (${cursor.createdAt}, ${cursor.id})` : undefined,
      // Match actual file parts, not text mentioning a URL or fetched tool images.
      // Both sides are scoped: imported references never grant ownership.
      inArray(sql`'/api/uploads/' || ${uploads.id}`, sql`(
        SELECT json_extract(part.value, '$.url')
        FROM ${messages}
        INNER JOIN ${chats} ON ${chats.id} = ${messages.chatId}
        CROSS JOIN json_each(${messages.parts}) AS part
        WHERE ${chats.userId} = ${userId}
          AND ${messages.role} = 'user'
          AND part.type = 'object'
          AND json_extract(part.value, '$.type') = 'file'
      )`),
      // Treat search as a literal substring (including %, _ and quotes).
      query ? sql`instr(unicode_lower(${uploads.filename}), unicode_lower(${query})) > 0` : undefined,
    ))
    .orderBy(desc(uploads.createdAt), desc(uploads.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      ...row,
      url: `/api/uploads/${row.id}`,
      createdAt: row.createdAt.getTime(),
    })),
    nextCursor: rows.length > PAGE_SIZE && last
      ? JSON.stringify({ createdAt: last.createdAt.getTime(), id: last.id })
      : null,
  };
}
