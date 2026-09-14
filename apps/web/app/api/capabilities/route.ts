import { preflight, withCors } from "@/lib/cors";
import { auth } from "@/lib/auth/server";
import { listServerCapabilities } from "@/lib/db/serverCapabilities";
import { getImageCapability } from "@/lib/images/capability";
import { getVoiceCapability } from "@/lib/voice/capability";

export const OPTIONS = preflight;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return withCors(request, new Response("Unauthorized", { status: 401 }));
  const configuredCapabilities = listServerCapabilities();
  return withCors(request, Response.json({
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
      images: getImageCapability(),
      voice: getVoiceCapability(),
    },
  }));
}
