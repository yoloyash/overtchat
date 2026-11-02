import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type SearchHit = {
  chatId: string;
  title: string | null;
  updatedAt: number;
  snippet: string | null;
  messageId: string | null;
};

// FTS5 has its own mini query language — wrap the whole thing as a quoted
// phrase so user punctuation can't blow up the parser, then append `*` to the
// last token for type-ahead prefix matching.
function toMatchQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter((t) => t.length > 0);
  if (!tokens.length) return "";
  const last = tokens.pop()!;
  const phrase = tokens.length ? `"${tokens.join(" ")}" ` : "";
  return `${phrase}"${last}"*`;
}

export async function searchChats(
  userId: string,
  rawQuery: string,
  limit = 30,
): Promise<SearchHit[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];

  const match = toMatchQuery(q);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  // Top-ranked FTS hit per chat. `bm25` returns lower = better, so ordering
  // by score ascending puts the best match first.
  //
  // The FTS5 auxiliary functions (`snippet`, `bm25`) must run inside the
  // MATCH scan itself. Putting them in the same SELECT as a window function
  // does not work: SQLite materializes the scan first and evaluates the
  // remaining expressions afterwards, when the FTS cursor is gone, and fails
  // with "unable to use function snippet in the requested context". So the
  // scan computes the snippet and score in its own CTE and the window
  // function ranks that materialized result.
  const rows = match
    ? await db.all<{
        chatId: string;
        messageId: string;
        title: string | null;
        updatedAt: number;
        snippet: string | null;
        score: number;
      }>(sql`
        WITH ranked AS (
          SELECT
            fts.chat_id AS chatId,
            fts.message_id AS messageId,
            snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet,
            bm25(messages_fts) AS score
          FROM messages_fts fts
          WHERE messages_fts MATCH ${match} AND fts.user_id = ${userId}
        ),
        hits AS (
          SELECT
            ranked.*,
            ROW_NUMBER() OVER (
              PARTITION BY ranked.chatId ORDER BY ranked.score
            ) AS rn
          FROM ranked
        )
        SELECT
          h.chatId,
          h.messageId,
          c.title AS title,
          c.updated_at AS updatedAt,
          h.snippet,
          h.score
        FROM hits h
        JOIN chats c ON c.id = h.chatId
        WHERE h.rn = 1
        ORDER BY h.score
        LIMIT ${limit}
      `)
    : [];

  const titleRows = await db.all<{
    chatId: string;
    title: string | null;
    updatedAt: number;
  }>(sql`
    SELECT id AS chatId, title, updated_at AS updatedAt
    FROM chats
    WHERE user_id = ${userId} AND title LIKE ${like} ESCAPE '\\'
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);

  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const r of rows) {
    if (seen.has(r.chatId)) continue;
    seen.add(r.chatId);
    out.push({
      chatId: r.chatId,
      title: r.title,
      updatedAt: Number(r.updatedAt),
      snippet: r.snippet,
      messageId: r.messageId,
    });
  }
  for (const r of titleRows) {
    if (seen.has(r.chatId)) continue;
    seen.add(r.chatId);
    out.push({
      chatId: r.chatId,
      title: r.title,
      updatedAt: Number(r.updatedAt),
      snippet: null,
      messageId: null,
    });
  }
  return out.slice(0, limit);
}
