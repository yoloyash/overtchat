import { auth } from "@/lib/auth/server";
import {
  listServerCapabilities,
  toAdminServerCapability,
} from "@/lib/db/serverCapabilities";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  return Response.json({
    capabilities: listServerCapabilities().map(toAdminServerCapability),
  });
}
