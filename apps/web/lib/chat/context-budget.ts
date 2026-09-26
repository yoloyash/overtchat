import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";
import { asSchema, type ModelMessage, type ToolSet } from "ai";

let encoder: Tiktoken | undefined;
const mediaTypes = new Set([
  "image",
  "file",
  "image-data",
  "image-url",
  "file-data",
  "file-url",
]);
function tokenizer() {
  return (encoder ??= new Tiktoken(o200kBase));
}

// A local tokenizer is an estimate for non-OpenAI models. Headroom and provider
// usage calibration account for chat templates and tokenizer differences.
export function countTextTokens(text: string): number {
  return tokenizer().encode(text, [], []).length;
}

export function splitContextText(text: string, tokens: number): string[] {
  const encoded = tokenizer().encode(text, [], []);
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += tokens) {
    chunks.push(tokenizer().decode(encoded.slice(i, i + tokens)));
  }
  return chunks;
}

export function contextText(value: unknown): string {
  if (typeof value === "string") return value;
  return (
    JSON.stringify(value, (key, item) => {
      if (item && typeof item === "object" && mediaTypes.has(item.type)) {
        return `[${item.type} attachment${item.filename ? `: ${item.filename}` : ""}]`;
      }
      if (item instanceof Uint8Array || item instanceof URL)
        return "[attachment]";
      if (key === "providerOptions") return undefined;
      if (typeof item === "string" && item.startsWith("data:"))
        return "[attachment]";
      return item;
    }) ?? ""
  );
}

const messageCounts = new WeakMap<ModelMessage, number>();
function mediaAllowance(value: unknown): number {
  if (
    !value ||
    typeof value !== "object" ||
    value instanceof Uint8Array ||
    value instanceof URL
  )
    return 0;
  if (Array.isArray(value))
    return value.reduce((n, part) => n + mediaAllowance(part), 0);
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string" && mediaTypes.has(record.type))
    return 4096;
  return Object.values(record).reduce<number>(
    (n, part) => n + mediaAllowance(part),
    0,
  );
}

export function countMessageTokens(message: ModelMessage): number {
  const cached = messageCounts.get(message);
  if (cached !== undefined) return cached;
  const tokens =
    typeof message.content === "string"
      ? 8 + countTextTokens(message.content)
      : 8 +
        message.content.reduce((total, part) => {
          // Do not tokenize base64 as text. Images/files have provider-dependent costs;
          // use a conservative allowance and calibrate against reported prompt usage.
          if (part.type === "image" || part.type === "file")
            return total + 4096;
          return (
            total + countTextTokens(contextText(part)) + mediaAllowance(part)
          );
        }, 0);
  messageCounts.set(message, tokens);
  return tokens;
}

export async function countToolTokens(tools: ToolSet): Promise<number> {
  let tokens = 0;
  for (const [name, tool] of Object.entries(tools)) {
    tokens +=
      countTextTokens(
        contextText({
          name,
          description: tool.description,
          parameters: tool.inputSchema
            ? await asSchema(tool.inputSchema).jsonSchema
            : undefined,
        }),
      ) + 16;
  }
  return tokens;
}

export function resolveContextBudget(
  contextWindow: number,
  capabilities?: { maxOutputTokens?: number; maxInputTokens?: number },
) {
  const maxOutputTokens = Math.max(
    1,
    Math.min(
      8192,
      Math.floor(contextWindow / 4),
      capabilities?.maxOutputTokens ?? Infinity,
    ),
  );
  const safetyMargin = Math.ceil(contextWindow * 0.1);
  const inputTokens = Math.min(
    Math.floor(contextWindow * 0.8),
    contextWindow - maxOutputTokens - safetyMargin,
    capabilities?.maxInputTokens ?? Infinity,
  );
  return { maxOutputTokens, inputTokens, safetyMargin };
}
