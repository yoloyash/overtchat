import { z } from "zod";
import {
  ABOUT_MAX_LENGTH,
  MEMORY_KEY_MAX_LENGTH,
  MEMORY_VALUE_MAX_LENGTH,
  OCCUPATION_MAX_LENGTH,
  PREFERRED_NAME_MAX_LENGTH,
} from "@overtchat/shared";

export {
  ABOUT_MAX_LENGTH,
  MEMORY_ENTRY_LIMIT,
  MEMORY_KEY_MAX_LENGTH,
  MEMORY_VALUE_MAX_LENGTH,
  OCCUPATION_MAX_LENGTH,
  PERSONALIZATION_CONTEXT_BYTE_LIMIT,
  PREFERRED_NAME_MAX_LENGTH,
} from "@overtchat/shared";
export type {
  Memory,
  MemoryInput,
  Personalization,
  PersonalizationInput,
  PersonalizationSnapshot,
} from "@overtchat/shared";

const optionalProfileField = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => {
      if (value == null) return null;
      const trimmed = value.trim();
      return trimmed || null;
    });

export const PersonalizationInputSchema = z.object({
  enabled: z.boolean(),
  preferredName: optionalProfileField(PREFERRED_NAME_MAX_LENGTH),
  occupation: optionalProfileField(OCCUPATION_MAX_LENGTH),
  about: optionalProfileField(ABOUT_MAX_LENGTH),
});

export const MemoryInputSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(MEMORY_KEY_MAX_LENGTH)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Key must start with a letter and contain only lowercase letters, numbers, and underscores",
    ),
  value: z.string().trim().min(1).max(MEMORY_VALUE_MAX_LENGTH),
});
