import "server-only";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";

export const streamContext = createResumableStreamContext({ waitUntil: after });
