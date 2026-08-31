import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { getChat, getLatestMessageRowId } from "@/lib/db/chats";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import { normalizeTimeZone } from "@/lib/chat/current-date";
import { getVoiceCapability } from "@/lib/voice/capability";
import { issueVoiceTicket } from "@/lib/voice/ticket";
import { VOICE_WEB_TOOLS } from "@/lib/voice/tools";
import {
  VOICE_REALTIME_PATH,
  type VoiceSessionGrant,
} from "@overtchat/shared";

const inputSchema = z.object({
  chatId: z.string().min(1).max(300),
  projectId: z.string().min(1).max(300).nullable().default(null),
  modelConfigId: z.string().min(1),
  webSearchEnabled: z.boolean().default(false),
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
  if (!modelConfig?.enabled) {
    return Response.json({ error: "Model config not found." }, { status: 404 });
  }

  const existingChat = await getChat(parsed.data.chatId, session.user.id);
  if (existingChat?.kind === "text") {
    return Response.json(
      { error: "Voice cannot be added to an existing text chat." },
      { status: 409 },
    );
  }
  const projectId = existingChat?.projectId ?? parsed.data.projectId;
  if (!existingChat && projectId) {
    const project = await getProject(projectId, session.user.id);
    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
  }
  const historyThroughRowId = existingChat
    ? await getLatestMessageRowId(existingChat.id)
    : null;

  const webSearchEnabled = Boolean(
    parsed.data.webSearchEnabled &&
      modelConfig.toolCallingEnabled !== false &&
      getServerCapability("search").provider !== "disabled",
  );
  const { token } = issueVoiceTicket({
    userId: session.user.id,
    chatId: parsed.data.chatId,
    projectId,
    newChat: existingChat === null,
    historyThroughRowId,
    modelConfigId: modelConfig.id,
    webSearchEnabled,
    timeZone: normalizeTimeZone(parsed.data.timeZone),
  });
  const grant: VoiceSessionGrant = {
    token,
    chatId: parsed.data.chatId,
    endpoint: VOICE_REALTIME_PATH,
    voice: getServerCapability("tts").voice ?? "af_heart",
    tools: webSearchEnabled ? VOICE_WEB_TOOLS : [],
  };
  return Response.json(grant, {
    headers: { "Cache-Control": "no-store" },
  });
}
