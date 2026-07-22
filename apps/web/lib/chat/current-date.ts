const DEFAULT_TIME_ZONE = "UTC";

/** Resolve a client-supplied IANA time zone without trusting it blindly. */
export function normalizeTimeZone(timeZone?: string): string {
  const candidate = timeZone?.trim();
  if (!candidate) return DEFAULT_TIME_ZONE;

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: candidate,
    }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Build stable, date-only system metadata using the user's local time zone. */
export function currentDateSystemPrompt(
  timeZone?: string,
  now = new Date(),
): string {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );

  return `Current date: ${parts.year}-${parts.month}-${parts.day}.`;
}
