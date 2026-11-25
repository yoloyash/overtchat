import "server-only";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";

let cached: ResumableStreamContext | null = null;
let didWarnMissingRedis = false;

/**
 * Ties buffering to the request that started the generation. A generation
 * the server starts itself, such as a scheduled task, has no request; this
 * long-lived process finishes the work either way.
 */
function keepAlive(work: Promise<unknown>): void {
  try {
    after(work);
  } catch {
    void work.catch(() => undefined);
  }
}

export function getStreamContext(): ResumableStreamContext | null {
  if (!process.env.REDIS_URL?.trim()) {
    if (!didWarnMissingRedis) {
      didWarnMissingRedis = true;
      console.warn(
        "[resumable-stream] REDIS_URL is not set; stream resumption is disabled.",
      );
    }
    return null;
  }

  if (!cached) {
    cached = createResumableStreamContext({ waitUntil: keepAlive });
  }
  return cached;
}
