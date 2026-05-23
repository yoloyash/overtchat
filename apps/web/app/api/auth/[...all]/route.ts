import { auth } from "@/lib/auth/server";
import { toNextJsHandler } from "better-auth/next-js";
import { withCors, preflight } from "@/lib/cors";

const handlers = toNextJsHandler(auth);

export async function GET(req: Request) {
  return withCors(req, await handlers.GET(req));
}

export async function POST(req: Request) {
  return withCors(req, await handlers.POST(req));
}

export function OPTIONS(req: Request) {
  return preflight(req);
}
