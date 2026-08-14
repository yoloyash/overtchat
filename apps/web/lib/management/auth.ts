import "server-only";
import { timingSafeEqual } from "node:crypto";

function safeMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export function managementRequestAuthorized(request: Request): boolean {
  const expected = process.env.OVERTCHAT_MANAGEMENT_SECRET;
  if (!expected || expected.length < 32) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const actual = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  return safeMatch(expected, actual);
}
