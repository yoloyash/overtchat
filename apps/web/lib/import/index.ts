import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";
import {
  listMemories,
  setMemory,
  updatePersonalization,
} from "@/lib/db/personalization";
import { memorySystemPrompt } from "@/lib/personalization/prompt";
import {
  MEMORY_CONTEXT_CHAR_LIMIT,
  MEMORY_ENTRY_LIMIT,
  MemoryInputSchema,
  PersonalizationInputSchema,
  type MemoryInput,
  type PersonalizationInput,
} from "@/lib/personalization/schema";
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
  importedMemories: number;
};

type NativePersonalization = {
  personalization?: PersonalizationInput;
  memories: MemoryInput[];
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
            metadata: msg.metadata,
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

function readNativePersonalization(data: unknown): NativePersonalization {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { memories: [] };
  }
  const envelope = data as Record<string, unknown>;
  if (envelope.format !== "overtchat") return { memories: [] };

  let personalization: PersonalizationInput | undefined;
  if (envelope.personalization !== undefined) {
    const parsed = PersonalizationInputSchema.safeParse(envelope.personalization);
    if (!parsed.success) {
      throw new ImportError("Invalid personalization data in overtchat export.");
    }
    personalization = parsed.data;
  }

  const rawMemories = envelope.memories;
  if (rawMemories === undefined) return { personalization, memories: [] };
  if (!Array.isArray(rawMemories)) {
    throw new ImportError("Invalid memories in overtchat export.");
  }
  const imported = rawMemories.map((memory) => {
    const parsed = MemoryInputSchema.safeParse(memory);
    if (!parsed.success) {
      throw new ImportError("Invalid memory in overtchat export.");
    }
    return parsed.data;
  });
  return { personalization, memories: imported };
}

async function writeNativePersonalization(
  userId: string,
  imported: NativePersonalization,
): Promise<number> {
  if (!imported.personalization && imported.memories.length === 0) return 0;
  const current = await listMemories(userId);
  const merged = new Map(
    current.map((memory) => [memory.key, { key: memory.key, value: memory.value }]),
  );
  for (const memory of imported.memories) merged.set(memory.key, memory);
  const prospective = [...merged.values()];
  if (
    prospective.length > MEMORY_ENTRY_LIMIT ||
    (memorySystemPrompt(prospective)?.length ?? 0) > MEMORY_CONTEXT_CHAR_LIMIT
  ) {
    throw new ImportError("Imported memories exceed OvertChat's memory limit.");
  }

  if (imported.personalization) {
    await updatePersonalization(userId, imported.personalization);
  }
  for (const memory of imported.memories) setMemory(userId, memory);
  return imported.memories.length;
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
  const personalization =
    format === "ours" ? readNativePersonalization(data) : { memories: [] };
  const counts = writeChats(userId, normalized);
  const importedMemories = await writeNativePersonalization(
    userId,
    personalization,
  );
  return {
    format,
    importedChats: counts.chats,
    importedMessages: counts.messages,
    importedMemories,
  };
}
