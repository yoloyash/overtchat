import { auth } from "@/lib/auth/server";
import {
  CAPABILITY_IDS,
  serverCapabilityInputSchema,
  type CapabilityId,
} from "@/lib/capabilities/schema";
import {
  getServerCapability,
  toAdminServerCapability,
  updateServerCapability,
} from "@/lib/db/serverCapabilities";
import { getVoiceCapability } from "@/lib/voice/capability";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const { id } = await params;
  if (!CAPABILITY_IDS.includes(id as CapabilityId)) {
    return new Response("Not found", { status: 404 });
  }
  const parsed = serverCapabilityInputSchema.safeParse({
    ...(await request.json().catch(() => null)),
    id,
  });
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid capability." },
      { status: 400 },
    );
  }
  const current = getServerCapability(id as CapabilityId);
  if (parsed.data.provider === "bundled" && !current.bundledInstalled) {
    return Response.json(
      {
        error: `${id} is not installed on this server. Run: overtchat setup`,
        code: "not_installed",
      },
      { status: 409 },
    );
  }
  const apiKey = parsed.data.apiKey ?? current.apiKey;
  if (parsed.data.provider === "brave" && !apiKey) {
    return Response.json(
      { error: "Enter a Brave Search API key." },
      { status: 400 },
    );
  }
  if (
    (parsed.data.provider === "searxng" ||
      parsed.data.provider === "openai-compatible") &&
    !parsed.data.baseUrl
  ) {
    return Response.json(
      { error: "Enter the provider API base URL." },
      { status: 400 },
    );
  }
  if (
    parsed.data.provider === "openai-compatible" &&
    (parsed.data.id === "tts" || parsed.data.id === "stt") &&
    !parsed.data.model?.trim()
  ) {
    return Response.json(
      { error: "Enter the provider model name." },
      { status: 400 },
    );
  }
  if (
    parsed.data.provider === "openai-compatible" &&
    parsed.data.id === "tts" &&
    !parsed.data.voice?.trim()
  ) {
    return Response.json(
      { error: "Enter the default voice." },
      { status: 400 },
    );
  }
  const capability = updateServerCapability({ ...parsed.data, apiKey });
  return Response.json({
    capability: toAdminServerCapability(capability),
    voice: getVoiceCapability(),
  });
}
