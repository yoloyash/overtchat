import { serverCapabilitiesInputSchema } from "@/lib/capabilities/schema";
import {
  listServerCapabilities,
  replaceServerCapabilities,
  toAdminServerCapability,
} from "@/lib/db/serverCapabilities";
import { managementRequestAuthorized } from "@/lib/management/auth";

export async function GET(request: Request) {
  if (!managementRequestAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({
    capabilities: listServerCapabilities().map((capability) => ({
      id: capability.id,
      provider: capability.provider,
      bundledInstalled: capability.bundledInstalled,
      baseUrl: capability.baseUrl,
      apiKey: capability.apiKey,
      model: capability.model,
      voice: capability.voice,
    })),
  });
}

export async function PUT(request: Request) {
  if (!managementRequestAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const parsed = serverCapabilitiesInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid capabilities." },
      { status: 400 },
    );
  }
  const capabilities = replaceServerCapabilities(parsed.data.capabilities);
  return Response.json({
    capabilities: capabilities.map(toAdminServerCapability),
  });
}
