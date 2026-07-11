import "server-only";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";

let cached: ResumableStreamContext | null = null;
let didWarnMissingRedis = false;

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
    cached = createResumableStreamContext({ waitUntil: after });
  }
  return cached;
}
