import "server-only";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";

let cached: ResumableStreamContext | null = null;

export function getStreamContext(): ResumableStreamContext {
  if (!cached) {
    cached = createResumableStreamContext({ waitUntil: after });
  }
  return cached;
}
