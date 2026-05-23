/**
 * Per-request runtime context appended to the system prompt.
 *
 * Modeled on LibreChat's buildWebSearchDynamicContext: a small block of
 * "facts the assistant should know about *this* request" — currently just
 * the conversation date/time and turn number, but designed as a slot for
 * future additions (timezone, locale, user-supplied prefs, model caps).
 */

export interface RuntimeContextOptions {
  turn: number;
  searchEnabled?: boolean;
  now?: Date;
}

export function buildRuntimeContext({
  turn,
  searchEnabled,
  now = new Date(),
}: RuntimeContextOptions): string {
  const lines = [
    "# Runtime Context",
    `Conversation Date & Time: ${now.toISOString()}`,
    `Current Turn: ${turn}`,
  ];
  if (searchEnabled) {
    lines.push(
      `When citing, use turn number ${turn} in citation anchors (e.g. \\ue202turn${turn}search0).`,
    );
  }
  return lines.join("\n");
}
