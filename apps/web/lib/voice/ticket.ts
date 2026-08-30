import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const TICKET_VERSION = 1;
const TICKET_CONNECT_WINDOW_SECONDS = 120;
const TICKET_LIFETIME_SECONDS = 8 * 60 * 60;

export interface VoiceTicketPayload {
  version: typeof TICKET_VERSION;
  connectBy: number;
  expiresAt: number;
  userId: string;
  chatId: string;
  projectId: string | null;
  newChat: boolean;
  historyThroughRowId: number | null;
  modelConfigId: string;
  webSearchEnabled: boolean;
  timeZone: string;
}

function secret(): string {
  const value = process.env.VOICE_SHARED_SECRET?.trim();
  if (!value) throw new Error("VOICE_SHARED_SECRET is not configured");
  return value;
}

function signature(encodedPayload: string): Buffer {
  return createHmac("sha256", secret()).update(encodedPayload).digest();
}

export function issueVoiceTicket(
  payload: Omit<VoiceTicketPayload, "version" | "connectBy" | "expiresAt">,
  now = Date.now(),
): { token: string; connectBy: number; expiresAt: number } {
  const issuedAt = Math.floor(now / 1000);
  const connectBy = issuedAt + TICKET_CONNECT_WINDOW_SECONDS;
  const expiresAt = issuedAt + TICKET_LIFETIME_SECONDS;
  const encodedPayload = Buffer.from(
    JSON.stringify({ version: TICKET_VERSION, connectBy, expiresAt, ...payload }),
  ).toString("base64url");
  const encodedSignature = signature(encodedPayload).toString("base64url");
  return { token: `${encodedPayload}.${encodedSignature}`, connectBy, expiresAt };
}

export function verifyVoiceTicket(
  token: string,
  now = Date.now(),
): VoiceTicketPayload | null {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return null;
  let provided: Buffer;
  try {
    provided = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  const expected = signature(encodedPayload);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<VoiceTicketPayload>;
  if (
    payload.version !== TICKET_VERSION ||
    typeof payload.connectBy !== "number" ||
    !Number.isInteger(payload.connectBy) ||
    typeof payload.expiresAt !== "number" ||
    !Number.isInteger(payload.expiresAt) ||
    payload.expiresAt < payload.connectBy ||
    payload.expiresAt < Math.floor(now / 1000) ||
    typeof payload.userId !== "string" ||
    !payload.userId ||
    typeof payload.chatId !== "string" ||
    !payload.chatId ||
    (payload.projectId !== null && typeof payload.projectId !== "string") ||
    typeof payload.newChat !== "boolean" ||
    (payload.historyThroughRowId !== null &&
      (typeof payload.historyThroughRowId !== "number" ||
        !Number.isSafeInteger(payload.historyThroughRowId) ||
        payload.historyThroughRowId <= 0)) ||
    typeof payload.modelConfigId !== "string" ||
    !payload.modelConfigId ||
    typeof payload.webSearchEnabled !== "boolean" ||
    typeof payload.timeZone !== "string"
  ) {
    return null;
  }
  return payload as VoiceTicketPayload;
}
