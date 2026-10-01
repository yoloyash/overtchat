import { CLIENT_API_LEVEL, type PingResponse } from "@overtchat/shared";
import { APP_VERSION } from "@/lib/version";

export function GET() {
  const body: PingResponse & { instanceId?: string } = {
    ok: true,
    name: "overtchat",
    version: APP_VERSION,
    apiLevel: CLIENT_API_LEVEL,
    instanceId: process.env.OVERTCHAT_INSTANCE_ID || undefined,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
