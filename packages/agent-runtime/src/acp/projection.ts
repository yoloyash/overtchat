import type {
  ContentBlock,
  ContentChunk,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

type Part = Record<string, unknown>;
export type AcpMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult";
  content: Part[];
  overtchatTurnId: string;
  overtchatSubmissionId?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  overtchatPartial?: boolean;
};

export function contentPart(content: ContentBlock, thinking = false): Part {
  if (content.type === "text")
    return thinking
      ? { type: "thinking", thinking: content.text }
      : { type: "text", text: content.text };
  if (content.type === "image")
    return {
      type: "image",
      data: content.data,
      mimeType: content.mimeType,
    };
  if (content.type === "resource" && "text" in content.resource) {
    return { type: "text", text: content.resource.text };
  }
  if (content.type === "resource_link")
    return { type: "text", text: `${content.name}: ${content.uri}` };
  return { type: "text", text: `[${content.type} content]` };
}

export function toolDetails(tool: ToolCallUpdate): Record<string, unknown> {
  const raw = tool.rawInput;
  const input: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...raw }
      : raw == null
        ? {}
        : { input: raw };
  if (tool.locations?.[0]?.path && !input.path)
    input.path = tool.locations[0].path;
  const diff = tool.content?.find((item) => item.type === "diff");
  if (diff?.type === "diff") {
    input.path = diff.path;
    input.oldText = diff.oldText ?? "";
    input.newText = diff.newText;
  }
  return input;
}

function toolOutput(tool: ToolCallUpdate): Part[] {
  const content =
    tool.content?.flatMap((item): Part[] => {
      if (item.type === "content") return [contentPart(item.content)];
      if (item.type === "diff")
        return [
          {
            type: "text",
            text: `${item.path}\n--- before\n${item.oldText ?? ""}\n+++ after\n${item.newText}`,
          },
        ];
      return [];
    }) ?? [];
  if (!content.length && tool.rawOutput != null) {
    content.push({
      type: "text",
      text:
        typeof tool.rawOutput === "string"
          ? tool.rawOutput
          : JSON.stringify(tool.rawOutput, null, 2),
    });
  }
  return content;
}

/** Provider history and live updates use the same projection. No runtime events
 * are emitted while replaying, so loading history cannot start a new turn. */
export class AcpProjection {
  readonly messages: AcpMessage[] = [];
  private readonly tools = new Map<string, ToolCallUpdate>();
  private segment?: AcpMessage;
  private chunkKey?: string;
  private sequence = 0;
  private turn = 0;
  private echoedUser?: AcpMessage;

  constructor(private readonly sessionId: () => string) {}

  beginTurn(
    text: string,
    images: ContentBlock[],
    submissionId?: string,
  ): AcpMessage {
    this.turn += 1;
    this.segment = undefined;
    this.chunkKey = undefined;
    const user = this.create("user", `user-${++this.sequence}`);
    user.content = [
      { type: "text", text },
      ...images.map((image) => contentPart(image)),
    ];
    user.overtchatSubmissionId = submissionId;
    this.echoedUser = user;
    return user;
  }

  endTurn(): AcpMessage[] {
    this.segment = undefined;
    this.chunkKey = undefined;
    this.echoedUser = undefined;
    const changed: AcpMessage[] = [];
    for (const [id, tool] of this.tools) {
      if (tool.status !== "completed" && tool.status !== "failed") {
        changed.push(
          ...this.tool({
            toolCallId: id,
            status: "failed",
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Tool call ended without a result.",
                },
              },
            ],
          }),
        );
      }
    }
    return changed;
  }

  /** Append completed local feedback omitted from native history. Allocate IDs
   * after replay so subsequent turns cannot collide with the retained rows. */
  appendTurn(messages: readonly AcpMessage[]): void {
    this.endTurn();
    this.turn += 1;
    for (const message of messages) {
      const appended = this.create(
        message.role,
        `${message.role}-${++this.sequence}`,
      );
      Object.assign(appended, structuredClone(message), {
        id: appended.id,
        overtchatTurnId: appended.overtchatTurnId,
      });
    }
  }

  update(update: SessionUpdate): AcpMessage[] {
    switch (update.sessionUpdate) {
      case "user_message_chunk":
        // Some agents echo the submitted prompt; the local row already includes images.
        if (this.echoedUser) return [];
        return [this.chunk("user", update)];
      case "agent_message_chunk":
        this.echoedUser = undefined;
        return [this.chunk("assistant", update)];
      case "agent_thought_chunk":
        this.echoedUser = undefined;
        return [this.chunk("assistant", update, true)];
      case "tool_call":
      case "tool_call_update":
        return this.tool(update);
      case "plan": {
        const message = this.assistant();
        const id = `acp-plan-${this.turn}`;
        const part = {
          type: "taskList",
          id,
          items: update.entries.map((entry, index) => ({
            id: `${id}-${index}`,
            step: entry.content,
            status: entry.status,
          })),
        };
        const index = message.content.findIndex(
          (part) => part.type === "taskList",
        );
        if (index < 0) message.content.push(part);
        else message.content[index] = part;
        return [message];
      }
      default:
        return [];
    }
  }

  private create(role: AcpMessage["role"], id: string): AcpMessage {
    const message: AcpMessage = {
      id: `${this.sessionId()}:${id}`,
      role,
      content: [],
      overtchatTurnId: `${this.sessionId()}:turn-${this.turn}`,
    };
    this.messages.push(message);
    return message;
  }

  private assistant(): AcpMessage {
    if (this.segment?.role !== "assistant") {
      this.segment = this.create("assistant", `assistant-${++this.sequence}`);
      this.chunkKey = undefined;
    }
    return this.segment;
  }

  private chunk(
    role: "user" | "assistant",
    chunk: ContentChunk,
    thinking = false,
  ): AcpMessage {
    const key = chunk.messageId ?? undefined;
    if (
      !this.segment ||
      this.segment.role !== role ||
      (key && key !== this.chunkKey)
    ) {
      if (role === "user") this.turn += 1;
      this.segment = this.create(role, `${role}-${++this.sequence}`);
      this.chunkKey = key;
    }
    const part = contentPart(chunk.content, thinking);
    const last = this.segment.content.at(-1);
    if (
      last &&
      last.type === part.type &&
      (part.type === "text" || part.type === "thinking")
    ) {
      const field = part.type === "text" ? "text" : "thinking";
      last[field] = String(last[field]) + String(part[field]);
    } else this.segment.content.push(part);
    return this.segment;
  }

  private tool(update: ToolCallUpdate | ToolCall): AcpMessage[] {
    const previous = this.tools.get(update.toolCallId);
    const tool = {
      ...previous,
      ...Object.fromEntries(
        Object.entries(update).filter(([, value]) => value != null),
      ),
    } as ToolCallUpdate;
    this.tools.set(tool.toolCallId, tool);
    let owner = this.messages.find(
      (message) =>
        message.role === "assistant" &&
        message.content.some(
          (part) => part.type === "toolCall" && part.id === tool.toolCallId,
        ),
    );
    owner ??= this.assistant();
    const name =
      tool.kind === "execute"
        ? "terminal"
        : tool.kind === "edit"
          ? "edit"
          : (tool.kind ?? tool.title ?? "tool");
    const part = {
      type: "toolCall",
      id: tool.toolCallId,
      name,
      arguments: { title: tool.title, ...toolDetails(tool) },
    };
    const index = owner.content.findIndex(
      (part) => part.type === "toolCall" && part.id === tool.toolCallId,
    );
    if (index < 0) owner.content.push(part);
    else owner.content[index] = part;
    const changed = [owner];
    const content = toolOutput(tool);
    const terminal = tool.status === "completed" || tool.status === "failed";
    if (terminal || content.length) {
      let result = this.messages.find(
        (message) =>
          message.role === "toolResult" &&
          message.toolCallId === tool.toolCallId,
      );
      result ??= this.create("toolResult", `result:${tool.toolCallId}`);
      Object.assign(result, {
        toolCallId: tool.toolCallId,
        toolName: name,
        content,
        isError: tool.status === "failed",
        overtchatPartial: !terminal,
      });
      changed.push(result);
      this.segment = undefined;
      this.chunkKey = undefined;
    }
    return changed;
  }
}
