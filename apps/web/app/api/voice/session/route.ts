import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import { normalizeTimeZone } from "@/lib/chat/current-date";
import { getVoiceCapability } from "@/lib/voice/capability";
import { issueVoiceTicket } from "@/lib/voice/ticket";
import { VOICE_WEB_TOOLS } from "@/lib/voice/tools";
import type { VoiceSessionGrant } from "@overtchat/shared";

const inputSchema = z.object({
  modelConfigId: z.string().min(1),
  webSearchEnabled: z.boolean().default(false),
  timeZone: z.string().max(100).default("UTC"),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const capability = getVoiceCapability();
  if (!capability.available || !capability.endpoint) {
    return Response.json(
      {
        error: "Realtime voice is unavailable.",
        reason: capability.unavailableReason,
      },
      { status: 503 },
    );
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid voice session request." }, { status: 400 });
  }
  const modelConfig = await getModelConfig(parsed.data.modelConfigId);
  if (!modelConfig?.enabled) {
    return Response.json({ error: "Model config not found." }, { status: 404 });
  }

  const webSearchEnabled = Boolean(
    parsed.data.webSearchEnabled &&
      modelConfig.toolCallingEnabled !== false &&
      getServerCapability("search").provider !== "disabled",
  );
  const { token, connectBy } = issueVoiceTicket({
    userId: session.user.id,
    modelConfigId: modelConfig.id,
    webSearchEnabled,
    timeZone: normalizeTimeZone(parsed.data.timeZone),
  });
  const grant: VoiceSessionGrant = {
    token,
    model: token,
    endpoint: capability.endpoint,
    expiresAt: connectBy,
    tools: webSearchEnabled ? VOICE_WEB_TOOLS : [],
  };
  return Response.json(grant, {
    headers: { "Cache-Control": "no-store" },
  });
}
