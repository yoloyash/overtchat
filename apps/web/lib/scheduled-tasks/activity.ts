/** The chat a path shows, when it shows one. */
export function chatIdOfPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** A run as the activity list reports it; only what an alert reads. */
interface ActivityRun {
  runId: string;
  status: string;
  chatId: string | null;
}

/**
 * The runs that ended with something to read since the last look. `known`
 * holds the runs that had already ended then; null on the first look, when
 * nothing is news: those results were there before the page was.
 */
export function runsEndedSince<T extends ActivityRun>(
  known: ReadonlySet<string> | null,
  runs: readonly T[],
): T[] {
  if (known === null) return [];
  return runs.filter(
    (run) =>
      (run.status === "success" || run.status === "error") &&
      run.chatId !== null &&
      !known.has(run.runId),
  );
}

/** The runs that are over, for the next look to compare against. */
export function endedRunIds(runs: readonly ActivityRun[]): Set<string> {
  return new Set(
    runs.filter((run) => run.status !== "running").map((run) => run.runId),
  );
}
