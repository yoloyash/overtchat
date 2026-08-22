import type {
  LanguageModelV4FilePart,
  LanguageModelV4Middleware,
  LanguageModelV4Prompt,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";

const ATTACHED_IMAGE_TEXT = "Attached image(s) from tool result:";
const IMAGE_ONLY_TOOL_RESULT_TEXT = "(see attached image)";
const OMITTED_IMAGE_TEXT = "[image omitted: model does not support vision]";

interface ToolImageOptions {
  supportsImageInput?: boolean;
}

type ToolOutputContentPart = Extract<
  LanguageModelV4ToolResultOutput,
  { type: "content" }
>["value"][number];
type ToolOutputFilePart = Extract<ToolOutputContentPart, { type: "file" }>;

/**
 * OpenAI Chat Completions restricts tool-message content to text. Preserve that
 * pairing, then carry image-bearing tool output in a following multimodal user
 * message. This mirrors OMP's provider adapter and the upstream AI SDK fix:
 * https://github.com/vercel/ai/pull/12621
 */
export function openAICompatibleToolImagesMiddleware({
  supportsImageInput = true,
}: ToolImageOptions = {}): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => ({
      ...params,
      prompt: promoteToolResultImages(params.prompt, supportsImageInput),
    }),
  };
}

export function promoteToolResultImages(
  prompt: LanguageModelV4Prompt,
  supportsImageInput = true,
): LanguageModelV4Prompt {
  const converted: LanguageModelV4Prompt = [];

  for (let index = 0; index < prompt.length; index += 1) {
    const message = prompt[index];
    if (message.role !== "tool") {
      converted.push(message);
      continue;
    }

    const images: LanguageModelV4FilePart[] = [];
    let runIndex = index;
    while (runIndex < prompt.length && prompt[runIndex].role === "tool") {
      const toolMessage = prompt[runIndex];
      if (toolMessage.role !== "tool") break;

      converted.push({
        ...toolMessage,
        content: toolMessage.content.map((part) =>
          part.type === "tool-result"
            ? promoteToolResultPart(
                part,
                images,
                supportsImageInput,
              )
            : part,
        ),
      });
      runIndex += 1;
    }
    index = runIndex - 1;

    if (images.length > 0) {
      converted.push({
        role: "user",
        content: [
          { type: "text", text: ATTACHED_IMAGE_TEXT },
          ...images,
        ],
      });
    }
  }

  return converted;
}

function promoteToolResultPart(
  part: LanguageModelV4ToolResultPart,
  images: LanguageModelV4FilePart[],
  supportsImageInput: boolean,
): LanguageModelV4ToolResultPart {
  if (part.output.type !== "content") return part;

  const text: string[] = [];
  let hasImages = false;

  for (const item of part.output.value) {
    if (item.type === "text") {
      text.push(item.text);
      continue;
    }

    if (isPortableImage(item)) {
      hasImages = true;
      if (supportsImageInput) {
        images.push(item);
      }
      continue;
    }

    text.push(JSON.stringify(item));
  }

  if (!supportsImageInput && hasImages) text.push(OMITTED_IMAGE_TEXT);

  const output: LanguageModelV4ToolResultOutput = {
    type: "text",
    value:
      text.length > 0
        ? text.join("\n")
        : hasImages
          ? IMAGE_ONLY_TOOL_RESULT_TEXT
          : "",
  };

  return { ...part, output };
}

function isPortableImage(
  part: ToolOutputContentPart,
): part is ToolOutputFilePart {
  return (
    part.type === "file" &&
    (part.mediaType === "image" || part.mediaType.startsWith("image/")) &&
    (part.data.type === "data" || part.data.type === "url")
  );
}
