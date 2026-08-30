import {
  dynamicTool,
  jsonSchema,
  streamText,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getActivePersonalization } from "@/lib/db/personalization";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";
import { currentDateSystemPrompt } from "@/lib/chat/current-date";
import {
  memorySystemPrompt,
  userProfileSystemPrompt,
} from "@/lib/personalization/prompt";
import { verifyVoiceTicket } from "@/lib/voice/ticket";
import { authorizeVoiceService } from "@/lib/voice/internal-auth";
import { VOICE_CONVERSATION_PROMPT } from "@/lib/voice/prompt";
import { VOICE_WEB_SEARCH_PROMPT } from "@/lib/voice/tools";

export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const item = record(part);
      if (!item) return "";
      return typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseToolInput(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function toModelMessages(value: unknown): ModelMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();

  for (const raw of value) {
    const message = record(raw);
    if (!message || typeof message.role !== "string") continue;
    // Realtime session instructions are browser-controlled. Only server-owned
    // prompts may supply system instructions.
    if (message.role === "system") continue;
    if (message.role === "user") {
      const content = textContent(message.content);
      if (content) messages.push({ role: "user", content });
      continue;
    }
    if (message.role === "assistant") {
      const content: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
      const text = textContent(message.content);
      if (text) content.push({ type: "text", text });
      if (Array.isArray(message.tool_calls)) {
        for (const rawCall of message.tool_calls) {
          const call = record(rawCall);
          const fn = record(call?.function);
          const callId = typeof call?.id === "string" ? call.id : "";
          const name = typeof fn?.name === "string" ? fn.name : "";
          if (!callId || !name) continue;
          toolNames.set(callId, name);
          content.push({
            type: "tool-call",
            toolCallId: callId,
            toolName: name,
            input: parseToolInput(fn?.arguments),
          });
        }
      }
      if (content.length) messages.push({ role: "assistant", content });
      continue;
    }
    if (message.role === "tool") {
      const callId = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      const toolName = toolNames.get(callId);
      if (!callId || !toolName) continue;
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: callId,
            toolName,
            output: { type: "text", value: textContent(message.content) },
          },
        ],
      });
    }
  }
  return messages;
}

function requestTools(value: unknown): ToolSet {
  if (!Array.isArray(value)) return {};
  const tools: ToolSet = {};
  for (const raw of value) {
    const outer = record(raw);
    const definition = record(outer?.function) ?? outer;
    if (!definition || definition.type && definition.type !== "function") continue;
    const name = definition.name;
    if (typeof name !== "string" || !name) continue;
    const parameters = record(definition.parameters) ?? {
      type: "object",
      properties: {},
    };
    tools[name] = dynamicTool({
      description:
        typeof definition.description === "string"
          ? definition.description
          : undefined,
      inputSchema: jsonSchema(parameters),
    });
  }
  return tools;
}

function warmupResponse() {
  return Response.json({
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "overtchat",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Ready." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function sse(value: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
}

export async function POST(request: Request) {
  if (!authorizeVoiceService(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = record(await request.json().catch(() => null));
  if (!body) return Response.json({ error: { message: "Invalid request." } }, { status: 400 });
  if (body.model === "overtchat") return warmupResponse();
  if (typeof body.model !== "string") {
    return Response.json({ error: { message: "A voice ticket is required." } }, { status: 401 });
  }
  const ticket = verifyVoiceTicket(body.model);
  if (!ticket) {
    return Response.json({ error: { message: "Voice ticket expired or invalid." } }, { status: 401 });
  }
  const modelConfig = await getModelConfig(ticket.modelConfigId);
  if (!modelConfig?.enabled) {
    return Response.json({ error: { message: "Model config not found." } }, { status: 404 });
  }

  const personalization = await getActivePersonalization(ticket.userId);
  const system = [
    modelConfig.systemPrompt,
    personalization
      ? userProfileSystemPrompt(personalization.personalization)
      : null,
    personalization ? memorySystemPrompt(personalization.memories) : null,
    ticket.webSearchEnabled ? VOICE_WEB_SEARCH_PROMPT : null,
    currentDateSystemPrompt(ticket.timeZone),
    VOICE_CONVERSATION_PROMPT,
  ].filter((part): part is string => Boolean(part?.trim()));
  const messages = toModelMessages(body.messages);
  const requestedTools = ticket.webSearchEnabled ? requestTools(body.tools) : {};
  const tools = modelConfig.toolCallingEnabled === false ? {} : requestedTools;
  const configured = createConfiguredLanguageModel({
    providerId: modelConfig.providerId,
    apiFormat: modelConfig.apiFormat,
    baseUrl: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    model: modelConfig.model,
    providerOptions: modelConfig.providerOptions,
    toolCallingEnabled: modelConfig.toolCallingEnabled,
    supportsImageInput: false,
  });
  const result = streamText({
    model: configured.model,
    instructions: system.join("\n\n"),
    messages,
    tools,
    toolChoice: Object.keys(tools).length ? "auto" : undefined,
    providerOptions: configured.providerOptions,
    abortSignal: request.signal,
    ...(typeof body.max_tokens === "number" && body.max_tokens > 0
      ? { maxOutputTokens: Math.floor(body.max_tokens) }
      : {}),
  });

  const completionId = `chatcmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = modelConfig.model;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const chunk = (delta: UnknownRecord, finishReason: string | null = null) =>
        controller.enqueue(
          sse({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          }),
        );
      let usedTools = false;
      const toolCallIndexes = new Map<string, number>();
      let finalUsage = { inputTokens: 0, outputTokens: 0 };
      try {
        chunk({ role: "assistant" });
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            chunk({ content: part.text });
          } else if (part.type === "tool-call") {
            usedTools = true;
            let index = toolCallIndexes.get(part.toolCallId);
            if (index === undefined) {
              index = toolCallIndexes.size;
              toolCallIndexes.set(part.toolCallId, index);
            }
            chunk({
              tool_calls: [
                {
                  index,
                  id: part.toolCallId,
                  type: "function",
                  function: {
                    name: part.toolName,
                    arguments: JSON.stringify(part.input ?? {}),
                  },
                },
              ],
            });
          } else if (part.type === "finish") {
            finalUsage = {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
            };
          } else if (part.type === "error") {
            throw part.error;
          }
        }
        chunk({}, usedTools ? "tool_calls" : "stop");
        controller.enqueue(
          sse({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [],
            usage: {
              prompt_tokens: finalUsage.inputTokens,
              completion_tokens: finalUsage.outputTokens,
              total_tokens: finalUsage.inputTokens + finalUsage.outputTokens,
            },
          }),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Model request failed.";
        controller.enqueue(sse({ error: { message, type: "voice_model_error" } }));
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
