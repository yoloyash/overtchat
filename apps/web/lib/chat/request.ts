import { safeValidateUIMessages, type UIMessage } from "ai";
import type { ChatRequestAction } from "@overtchat/shared";
import { z } from "zod";

const ChatRequestActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submit") }),
  z.object({
    type: z.literal("edit"),
    targetUserMessageId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("regenerate"),
    targetAssistantMessageId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("retry"),
    userMessageId: z.string().trim().min(1),
  }),
]);

const ChatRequestEnvelopeSchema = z.object({
  messages: z.unknown(),
  modelConfigId: z.string().trim().min(1, "Missing modelConfigId"),
  chatId: z.string().trim().min(1, "Missing chatId"),
  webSearchEnabled: z.boolean().optional().default(true),
  forceSearch: z.boolean().optional(),
  // Accepted during the mobile rollout. `true` maps cleanly to the new
  // one-message action; `false` now means the normal automatic policy.
  searchEnabled: z.boolean().optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  projectId: z.string().nullable().optional(),
  action: ChatRequestActionSchema.optional(),
  // Kept as a wire-compatibility input for already-open web clients and
  // released mobile clients. New clients send `action` explicitly.
  trigger: z
    .enum(["submit-message", "regenerate-message"])
    .optional()
    .default("submit-message"),
  messageId: z.string().optional(),
  temporary: z.boolean().optional().default(false),
});

export interface ParsedChatRequest {
  messages: UIMessage[];
  modelConfigId: string;
  chatId: string;
  webSearchEnabled: boolean;
  forceSearch: boolean;
  timeZone?: string;
  projectId?: string | null;
  action: ChatRequestAction;
  temporary: boolean;
}

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

export async function parseChatRequest(
  req: Request,
): Promise<ParsedChatRequest> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ChatRequestError("Invalid JSON body");
  }

  const envelope = ChatRequestEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new ChatRequestError(
      envelope.error.issues[0]?.message ?? "Invalid chat request",
    );
  }

  const validated = await safeValidateUIMessages({
    messages: envelope.data.messages,
  });
  if (!validated.success) {
    throw new ChatRequestError("Invalid chat messages");
  }
  if (validated.data.length === 0) {
    throw new ChatRequestError("No messages");
  }

  const last = validated.data[validated.data.length - 1];
  if (last.role !== "user") {
    throw new ChatRequestError("The final message must be a user message");
  }

  const action =
    envelope.data.action ??
    legacyChatRequestAction({
      trigger: envelope.data.trigger,
      messageId: envelope.data.messageId,
      userMessageId: last.id,
    });
  if (
    (action.type === "edit" && action.targetUserMessageId !== last.id) ||
    (action.type === "retry" && action.userMessageId !== last.id)
  ) {
    throw new ChatRequestError("Chat action does not match the user message");
  }

  const { searchEnabled } = envelope.data;
  const forceSearch = envelope.data.forceSearch ?? searchEnabled ?? false;
  return {
    messages: validated.data,
    modelConfigId: envelope.data.modelConfigId,
    chatId: envelope.data.chatId,
    webSearchEnabled: envelope.data.webSearchEnabled,
    forceSearch: envelope.data.webSearchEnabled && forceSearch,
    timeZone: envelope.data.timeZone,
    projectId: envelope.data.projectId,
    action,
    temporary: envelope.data.temporary,
  };
}

function legacyChatRequestAction({
  trigger,
  messageId,
  userMessageId,
}: {
  trigger: "submit-message" | "regenerate-message";
  messageId?: string;
  userMessageId: string;
}): ChatRequestAction {
  if (trigger === "regenerate-message") {
    return messageId
      ? { type: "regenerate", targetAssistantMessageId: messageId }
      : { type: "retry", userMessageId };
  }
  return messageId
    ? { type: "edit", targetUserMessageId: messageId }
    : { type: "submit" };
}
