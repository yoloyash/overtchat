import type { Personalization } from "./schema";

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
