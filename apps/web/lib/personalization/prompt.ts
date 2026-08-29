import {
  MEMORY_ENTRY_LIMIT,
  PERSONALIZATION_CONTEXT_BYTE_LIMIT,
  type Personalization,
} from "./schema";

export type PromptMemory = { key: string; value: string };

export function userProfileSystemPrompt(
  personalization: Pick<
    Personalization,
    "preferredName" | "occupation" | "about"
  >,
): string | null {
  const fields = [
    personalization.preferredName
      ? `Preferred name: ${personalization.preferredName}`
      : null,
    personalization.occupation
      ? `Occupation: ${personalization.occupation}`
      : null,
    personalization.about
      ? `More about the user: ${personalization.about}`
      : null,
  ].filter((value): value is string => value !== null);

  return fields.length ? ["# User profile", ...fields].join("\n") : null;
}

export function memorySystemPrompt(
  rows: readonly PromptMemory[],
): string | null {
  if (rows.length === 0) return null;
  return [
    "# Existing memory about the user",
    ...rows.map((memory) => `- \`${memory.key}\`: ${memory.value}`),
  ].join("\n");
}

export function personalizationSystemPrompt(
  personalization: Pick<
    Personalization,
    "preferredName" | "occupation" | "about"
  >,
  rows: readonly PromptMemory[],
): string | null {
  const parts = [
    userProfileSystemPrompt(personalization),
    memorySystemPrompt(rows),
  ].filter((value): value is string => value !== null);
  return parts.length ? parts.join("\n\n") : null;
}

export function personalizationContextUsage(
  personalization: Pick<
    Personalization,
    "preferredName" | "occupation" | "about"
  >,
  rows: readonly PromptMemory[],
) {
  const context = personalizationSystemPrompt(personalization, rows) ?? "";
  return {
    bytes: new TextEncoder().encode(context).byteLength,
    limit: PERSONALIZATION_CONTEXT_BYTE_LIMIT,
    entries: rows.length,
    entryLimit: MEMORY_ENTRY_LIMIT,
  };
}
