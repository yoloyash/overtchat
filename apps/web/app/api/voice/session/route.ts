import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { getChat } from "@/lib/db/chats";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import { normalizeTimeZone } from "@/lib/chat/current-date";
import { getVoiceCapability } from "@/lib/voice/capability";
import { issueVoiceTicket } from "@/lib/voice/ticket";
import { claimVoiceSession, endVoiceSession } from "@/lib/db/voiceSessions";
import { REASONING_EFFORTS } from "@overtchat/shared";
import {
  VOICE_REALTIME_PATH,
  type VoiceSessionGrant,
} from "@overtchat/shared";

const inputSchema = z.object({
  chatId: z.string().min(1).max(300),
  projectId: z.string().min(1).max(300).nullable().default(null),
  modelConfigId: z.string().min(1),
  webSearchEnabled: z.boolean().default(false),
  reasoningLevel: z.enum(["default", "off", "on", ...REASONING_EFFORTS]).default("default"),
  timeZone: z.string().max(100).default("UTC"),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const capability = getVoiceCapability();
  if (!capability.available) {
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
  if (!modelConfig?.enabled || modelConfig.modelType === "image") {
    return Response.json({ error: "Model config not found." }, { status: 404 });
  }

  const existingChat = await getChat(parsed.data.chatId, session.user.id);
  const projectId = existingChat?.projectId ?? parsed.data.projectId;
  if (!existingChat && projectId) {
    const project = await getProject(projectId, session.user.id);
    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
  }
  const webSearchEnabled = Boolean(
    parsed.data.webSearchEnabled &&
      modelConfig.toolCallingEnabled !== false &&
      getServerCapability("search").provider !== "disabled",
  );
  const sessionId = claimVoiceSession(parsed.data.chatId, session.user.id, session.session.id);
  if (!sessionId) return Response.json({ error: "This chat already has an active voice session or response." }, { status: 409 });
  const { token } = issueVoiceTicket({
    userId: session.user.id,
    chatId: parsed.data.chatId,
    projectId,
    sessionId,
    reasoningLevel: parsed.data.reasoningLevel,
    modelConfigId: modelConfig.id,
    webSearchEnabled,
    timeZone: normalizeTimeZone(parsed.data.timeZone),
  });
  const grant: VoiceSessionGrant = {
    token,
    sessionId,
    chatId: parsed.data.chatId,
    endpoint: VOICE_REALTIME_PATH,
    voice: getServerCapability("tts").voice ?? "af_heart",
  };
  return Response.json(grant, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.sessionId !== "string") return new Response("Invalid session", { status: 400 });
  endVoiceSession(body.sessionId, session.user.id);
  return new Response(null, { status: 204 });
}
