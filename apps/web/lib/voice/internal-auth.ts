import "server-only";
import { timingSafeEqual } from "node:crypto";

export function authorizeVoiceService(request: Request): boolean {
  const configured = process.env.VOICE_SHARED_SECRET?.trim();
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/iu, "");
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
