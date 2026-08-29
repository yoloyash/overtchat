import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assertPersonalizationCapacity,
  MemoryCapacityError,
} from "@/lib/db/personalization";
import {
  chats,
  memories,
  messages,
  userPersonalization,
} from "@/lib/db/schema";
import {
  MemoryInputSchema,
  PersonalizationInputSchema,
  type MemoryInput,
  type Personalization,
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

type ImportTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function writeChats(
  tx: ImportTransaction,
  userId: string,
  imported: ImportedChat[],
): { chats: number; messages: number } {
  let chatCount = 0;
  let msgCount = 0;

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

function writeNativePersonalization(
  tx: ImportTransaction,
  userId: string,
  imported: NativePersonalization,
): number {
  if (!imported.personalization && imported.memories.length === 0) return 0;
  const current = tx
    .select({ key: memories.key, value: memories.value })
    .from(memories)
    .where(eq(memories.userId, userId))
    .all();
  const merged = new Map(
    current.map((memory) => [memory.key, { key: memory.key, value: memory.value }]),
  );
  for (const memory of imported.memories) merged.set(memory.key, memory);

  const storedPersonalization = tx
    .select({
      enabled: userPersonalization.enabled,
      preferredName: userPersonalization.preferredName,
      occupation: userPersonalization.occupation,
      about: userPersonalization.about,
    })
    .from(userPersonalization)
    .where(eq(userPersonalization.userId, userId))
    .get();
  const personalization: Personalization =
    imported.personalization ??
    storedPersonalization ?? {
      enabled: true,
      preferredName: null,
      occupation: null,
      about: null,
    };
  try {
    assertPersonalizationCapacity(personalization, [...merged.values()]);
  } catch (error) {
    if (error instanceof MemoryCapacityError) {
      throw new ImportError(error.message);
    }
    throw error;
  }

  if (imported.personalization) {
    tx.insert(userPersonalization)
      .values({ userId, ...imported.personalization })
      .onConflictDoUpdate({
        target: userPersonalization.userId,
        set: { ...imported.personalization, updatedAt: new Date() },
      })
      .run();
  }
  for (const memory of imported.memories) {
    tx.insert(memories)
      .values({ id: crypto.randomUUID(), userId, ...memory })
      .onConflictDoUpdate({
        target: [memories.userId, memories.key],
        set: { value: memory.value, updatedAt: new Date() },
      })
      .run();
  }
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
  return db.transaction((tx) => {
    const counts = writeChats(tx, userId, normalized);
    const importedMemories = writeNativePersonalization(
      tx,
      userId,
      personalization,
    );
    return {
      format,
      importedChats: counts.chats,
      importedMessages: counts.messages,
      importedMemories,
    };
  });
}
