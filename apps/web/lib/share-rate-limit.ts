import "server-only";
import { shareHeaders } from "./share-headers";

type Kind = "page" | "file";
type Window = { count: number; reset: number };
const WINDOW_MS = 60_000;
const MAX_KEYS = 4096;
const limits = {
  page: { link: 120, server: 1200 },
  file: { link: 600, server: 6000 },
};

/** Per-link and server-wide budgets also bound abuse with forged forwarding headers. */
export function createShareReadLimiter(now = Date.now) {
  const buckets = new Map<string, Window>();
  let nextSweep = 0;
  return (id: string, kind: Kind): Response | null => {
    const time = now();
    if (time >= nextSweep) {
      for (const [key, bucket] of buckets)
        if (bucket.reset <= time) buckets.delete(key);
      nextSweep = time + WINDOW_MS;
    }
    for (const [key, maximum] of [
      [`server:${kind}`, limits[kind].server],
      [`link:${kind}:${id}`, limits[kind].link],
    ] as const) {
      let bucket = buckets.get(key);
      if (!bucket || bucket.reset <= time) {
        if (!bucket && buckets.size >= MAX_KEYS)
          return limited(WINDOW_MS / 1000);
        bucket = { count: 0, reset: time + WINDOW_MS };
        buckets.set(key, bucket);
      }
      if (bucket.count >= maximum)
        return limited(Math.max(1, Math.ceil((bucket.reset - time) / 1000)));
      bucket.count++;
    }
    return null;
  };
}

function limited(seconds: number) {
  return new Response(
    "Too many shared-chat requests. Please try again shortly.",
    {
      status: 429,
      headers: { ...shareHeaders, "Retry-After": String(seconds) },
    },
  );
}

export const limitShareRead = createShareReadLimiter();
