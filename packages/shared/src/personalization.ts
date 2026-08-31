export const PREFERRED_NAME_MAX_LENGTH = 80;
export const OCCUPATION_MAX_LENGTH = 160;
export const ABOUT_MAX_LENGTH = 1_000;
export const MEMORY_KEY_MAX_LENGTH = 64;
export const MEMORY_VALUE_MAX_LENGTH = 500;
export const PERSONALIZATION_CONTEXT_BYTE_LIMIT = 4_096;
export const MEMORY_ENTRY_LIMIT = 50;

export type PersonalizationInput = {
  enabled: boolean;
  preferredName: string | null;
  occupation: string | null;
  about: string | null;
};

export type MemoryInput = {
  key: string;
  value: string;
};

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
  contextUsage: {
    bytes: number;
    limit: number;
    entries: number;
    entryLimit: number;
  };
};
