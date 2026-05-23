import type { PingResponse } from "@overtchat/shared";
import { withCors, preflight } from "@/lib/cors";

const VERSION = process.env.npm_package_version ?? "0.1.0";

export function GET(req: Request) {
  const body: PingResponse = { ok: true, name: "overtchat", version: VERSION };
  return withCors(req, Response.json(body));
}

export function OPTIONS(req: Request) {
  return preflight(req);
}
