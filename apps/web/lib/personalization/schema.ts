import { z } from "zod";

export const PREFERRED_NAME_MAX_LENGTH = 80;
export const OCCUPATION_MAX_LENGTH = 160;
export const ABOUT_MAX_LENGTH = 1_000;
export const MEMORY_KEY_MAX_LENGTH = 64;
export const MEMORY_VALUE_MAX_LENGTH = 500;
export const MEMORY_CONTEXT_CHAR_LIMIT = 4_096;
export const MEMORY_ENTRY_LIMIT = 50;

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

export type PersonalizationInput = z.infer<typeof PersonalizationInputSchema>;
export type MemoryInput = z.infer<typeof MemoryInputSchema>;

export type Personalization = {
  enabled: boolean;
  preferredName: string | null;
  occupation: string | null;
  about: string | null;
};

export type Memory = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalizationSnapshot = {
  personalization: Personalization;
  memories: Memory[];
  memoryUsage: {
    characters: number;
    limit: number;
    entries: number;
    entryLimit: number;
  };
};
