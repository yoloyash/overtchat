import type { PingResponse } from "@overtchat/shared";
import { withCors, preflight } from "@/lib/cors";
import { APP_VERSION } from "@/lib/version";

export function GET(req: Request) {
  const body: PingResponse & { instanceId?: string } = {
    ok: true,
    name: "overtchat",
    version: APP_VERSION,
    instanceId: process.env.OVERTCHAT_INSTANCE_ID || undefined,
  };
  return withCors(
    req,
    Response.json(body, { headers: { "Cache-Control": "no-store" } }),
  );
}

export function OPTIONS(req: Request) {
  return preflight(req);
}
