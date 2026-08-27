import { safeValidateUIMessages, type UIMessage } from "ai";
import { z } from "zod";

const ChatRequestEnvelopeSchema = z.object({
  messages: z.unknown(),
  modelConfigId: z.string().trim().min(1, "Missing modelConfigId"),
  chatId: z.string().trim().min(1, "Missing chatId"),
  webSearchEnabled: z.boolean().optional().default(true),
  codeExecutionSupported: z.boolean().optional().default(false),
  forceSearch: z.boolean().optional(),
  // Accepted during the mobile rollout. `true` maps cleanly to the new
  // one-message action; `false` now means the normal automatic policy.
  searchEnabled: z.boolean().optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  projectId: z.string().nullable().optional(),
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
  codeExecutionSupported: boolean;
  forceSearch: boolean;
  timeZone?: string;
  projectId?: string | null;
  trigger: "submit-message" | "regenerate-message";
  messageId?: string;
  temporary: boolean;
  toolContinuation: boolean;
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
  const toolContinuation =
    last.role === "assistant" &&
    envelope.data.trigger === "submit-message" &&
    envelope.data.codeExecutionSupported &&
    hasCompletedCodeExecution(last);
  if (last.role !== "user" && !toolContinuation) {
    throw new ChatRequestError(
      "The final message must be a user message or completed code execution",
    );
  }
  if (
    envelope.data.trigger === "regenerate-message" &&
    !envelope.data.messageId
  ) {
    throw new ChatRequestError("Regenerate requires a messageId");
  }

  const { searchEnabled, ...data } = envelope.data;
  const forceSearch = data.forceSearch ?? searchEnabled ?? false;
  return {
    ...data,
    messages: validated.data,
    forceSearch: data.webSearchEnabled && forceSearch,
    toolContinuation,
  };
}

function hasCompletedCodeExecution(message: UIMessage): boolean {
  const lastStepStart = message.parts.reduce(
    (index, part, current) => (part.type === "step-start" ? current : index),
    -1,
  );
  const codeParts = message.parts
    .slice(lastStepStart + 1)
    .filter((part) => part.type === "tool-execute_code") as Array<{
    state?: string;
  }>;
  return (
    codeParts.length > 0 &&
    codeParts.every(
      (part) =>
        part.state === "output-available" || part.state === "output-error",
    )
  );
}
