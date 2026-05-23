import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";
import { extractSearchText } from "@/lib/search/extract";
import { importChatGPT } from "./chatgpt";
import { importClaude } from "./claude";
import { importOpenWebUI } from "./openwebui";
import { importOurs } from "./ours";
import { sniffFormat } from "./sniff";
import { ImportError, type ImportedChat, type ImportFormat } from "./types";
import { isZip, readJsonFromZip } from "./zip";

export { ImportError } from "./types";
export type { ImportFormat } from "./types";

export type ImportResult = {
  format: ImportFormat;
  importedChats: number;
  importedMessages: number;
};

function parseBody(bytes: Uint8Array): unknown {
  if (isZip(bytes)) return readJsonFromZip(bytes);
  try {
    const decoder = new TextDecoder("utf-8");
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new ImportError("File is neither valid JSON nor a readable zip.");
  }
}

function runAdapter(format: ImportFormat, data: unknown): ImportedChat[] {
  switch (format) {
    case "chatgpt":
      return importChatGPT(data);
    case "claude":
      return importClaude(data);
    case "openwebui":
      return importOpenWebUI(data);
    case "ours":
      return importOurs(data);
  }
}

function writeChats(
  userId: string,
  imported: ImportedChat[],
): { chats: number; messages: number } {
  let chatCount = 0;
  let msgCount = 0;

  db.transaction((tx) => {
    for (const chat of imported) {
      const chatId = crypto.randomUUID();
      tx.insert(chats)
        .values({
          id: chatId,
          userId,
          title: chat.title.slice(0, 200),
          createdAt: chat.createdAt,
          updatedAt: chat.createdAt,
        })
        .run();

      for (const msg of chat.messages) {
        const msgId = crypto.randomUUID();
        tx.insert(messages)
          .values({
            id: msgId,
            chatId,
            role: msg.role,
            parts: msg.parts,
            createdAt: msg.createdAt,
          })
          .run();

        const content = extractSearchText(msg.parts);
        if (content) {
          tx.run(sql`
            INSERT INTO messages_fts (content, message_id, chat_id, user_id)
            VALUES (${content}, ${msgId}, ${chatId}, ${userId})
          `);
        }
        msgCount++;
      }
      chatCount++;
    }
  });

  return { chats: chatCount, messages: msgCount };
}

export async function importChats(
  userId: string,
  fileBytes: Uint8Array,
): Promise<ImportResult> {
  const data = parseBody(fileBytes);
  const format = sniffFormat(data);
  if (!format) {
    throw new ImportError(
      "Unrecognized format. Supported: overtchat, ChatGPT, Claude.ai, OpenWebUI.",
    );
  }
  const normalized = runAdapter(format, data);
  const counts = writeChats(userId, normalized);
  return {
    format,
    importedChats: counts.chats,
    importedMessages: counts.messages,
  };
}
