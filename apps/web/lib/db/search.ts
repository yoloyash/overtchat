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

  // Top-ranked FTS hit per chat. `bm25` returns lower = better; we flip sign
  // so we can ORDER BY the score descending after the GROUP BY window.
  const rows = match
    ? await db.all<{
        chatId: string;
        messageId: string;
        title: string | null;
        updatedAt: number;
        snippet: string | null;
        score: number;
      }>(sql`
        WITH hits AS (
          SELECT
            fts.chat_id AS chatId,
            fts.message_id AS messageId,
            snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet,
            bm25(messages_fts) AS score,
            ROW_NUMBER() OVER (
              PARTITION BY fts.chat_id ORDER BY bm25(messages_fts)
            ) AS rn
          FROM messages_fts fts
          WHERE messages_fts MATCH ${match} AND fts.user_id = ${userId}
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
