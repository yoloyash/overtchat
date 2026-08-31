import { auth } from "@/lib/auth/server";
import { listServerCapabilities } from "@/lib/db/serverCapabilities";
import { getVoiceCapability } from "@/lib/voice/capability";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const configuredCapabilities = listServerCapabilities();
  return Response.json({
    capabilities: {
      ...Object.fromEntries(
        configuredCapabilities.map((capability) => [
          capability.id,
          {
            provider: capability.provider,
            available: capability.provider !== "disabled",
            bundledInstalled: capability.bundledInstalled,
          },
        ]),
      ),
      voice: getVoiceCapability(),
    },
  });
}
