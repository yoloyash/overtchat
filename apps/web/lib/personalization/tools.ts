import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  deleteMemoryByKey,
  MemoryCapacityError,
  setMemory,
} from "@/lib/db/personalization";
import {
  MEMORY_KEY_MAX_LENGTH,
  MEMORY_VALUE_MAX_LENGTH,
} from "@/lib/personalization/schema";

const memoryKey = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(MEMORY_KEY_MAX_LENGTH)
  .regex(/^[a-z][a-z0-9_]*$/)
  .describe(
    "Stable lowercase key starting with a letter and containing only letters, numbers, and underscores.",
  );

export function createMemoryTools(userId: string) {
  return Object.freeze({
    set_memory: tool({
      description:
        "Save or update a memory only when the user explicitly asks to remember or update something. Never save facts merely mentioned.",
      inputSchema: z.object({
        key: memoryKey,
        value: z
          .string()
          .trim()
          .min(1)
          .max(MEMORY_VALUE_MAX_LENGTH)
          .describe("Concise, self-contained memory."),
      }),
      execute: async (input) => {
        try {
          const memory = setMemory(userId, input);
          return { ok: true as const, key: memory.key, value: memory.value };
        } catch (error) {
          if (error instanceof MemoryCapacityError) {
            return { ok: false as const, error: error.message };
          }
          throw error;
        }
      },
    }),
    delete_memory: tool({
      description:
        "Delete a memory only when the user explicitly asks to forget it.",
      inputSchema: z.object({
        key: memoryKey.describe("Exact memory key to delete."),
      }),
      execute: async ({ key }) => ({
        ok: await deleteMemoryByKey(key, userId),
        key,
      }),
    }),
  });
}

export const MEMORY_TOOL_ORDER = Object.freeze([
  "set_memory",
  "delete_memory",
] as const);
