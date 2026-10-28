const MAX_INITIAL_AGENT_TITLE_CHARS = 60;

export function deriveInitialAgentSessionTitle(prompt: string): string | null {
  const firstContentLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstContentLine) return null;

  const normalized = firstContentLine.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const clamped = normalized.slice(0, MAX_INITIAL_AGENT_TITLE_CHARS).trim();
  return clamped.length > 0 ? clamped : null;
}

export function resolveInitialAgentSessionTitle({
  name,
  firstMessage,
}: {
  name?: string | null;
  firstMessage?: string | null;
}): string | null {
  const explicitTitle = typeof name === "string" ? name.trim() : "";
  return (
    explicitTitle ||
    (typeof firstMessage === "string"
      ? deriveInitialAgentSessionTitle(firstMessage)
      : null)
  );
}

/**
 * Whether a session still shows the first line of its first message, so a
 * generated title can replace it. Names set by the user or the agent stay.
 */
export function agentSessionNeedsGeneratedTitle({
  name,
  firstMessage,
}: {
  name: string | null;
  firstMessage: string | null;
}): boolean {
  if (!firstMessage?.trim()) return false;
  const current = name?.trim() ?? "";
  return !current || current === deriveInitialAgentSessionTitle(firstMessage);
}
