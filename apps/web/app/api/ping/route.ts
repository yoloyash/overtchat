import type { PingResponse } from "@overtchat/shared";
import { withCors, preflight } from "@/lib/cors";
import { APP_VERSION } from "@/lib/version";

export function GET(req: Request) {
  const body: PingResponse = {
    ok: true,
    name: "overtchat",
    version: APP_VERSION,
  };
  return withCors(req, Response.json(body));
}

export function OPTIONS(req: Request) {
  return preflight(req);
}
