import { auth } from "@/lib/auth/server";
import { listServerCapabilities } from "@/lib/db/serverCapabilities";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return Response.json({
    capabilities: Object.fromEntries(
      listServerCapabilities().map((capability) => [
        capability.id,
        {
          provider: capability.provider,
          available: capability.provider !== "disabled",
          bundledInstalled: capability.bundledInstalled,
        },
      ]),
    ),
  });
}
