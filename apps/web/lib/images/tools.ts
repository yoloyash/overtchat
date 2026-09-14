import "server-only";
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import {
  IMAGE_SIZES,
  IMAGE_QUALITIES,
  DEFAULT_IMAGE_OPTIONS,
  isGeneratedImage,
  isImageToolPart,
  type ImageGenerationOptions,
  type ImageGenerationOutput,
} from "@overtchat/shared";
import { getImageModelConfig } from "@/lib/db/modelConfigs";
import { readFetchedImage, storeFetchedImage } from "@/lib/db/uploads";
import {
  runImageProvider,
  type ImageConnection,
} from "@/lib/providers/server/image-generation";

export const IMAGE_TOOL_PROMPT = `Image creation:
Use generate_image only when the user asks to create an image, and edit_image when they ask to change or combine existing images. Never create extra images or automatically retry a failed generation. Each call produces one image.
Images are displayed directly in chat with download and edit controls. Do not embed duplicate markdown images. Use the exact image IDs supplied in the conversation when editing. Never invent image IDs. If the reference is ambiguous, ask which image to use.
The image model is separate from the conversational model. A text-only conversational model can still create and edit images using these tools.`;

export { getImageCapability } from "./capability";

function imageConnection(): ImageConnection {
  const config = getImageModelConfig();
  if (
    !config ||
    (config.providerId !== "openai" && config.providerId !== "google")
  ) {
    throw new Error(
      "Image generation is not configured. Ask an administrator to enable an image model in Settings → Models.",
    );
  }
  return {
    providerId: config.providerId,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  };
}

function referencedImageIds(messages: UIMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages)
    for (const part of message.parts) {
      if (part.type === "file" && part.mediaType.startsWith("image/")) {
        const match = /^\/api\/uploads\/([a-zA-Z0-9_-]+)$/.exec(part.url);
        if (match) ids.add(match[1]);
      }
      if (isImageToolPart(part) && Array.isArray(part.output?.images)) {
        for (const image of part.output.images)
          if (isGeneratedImage(image)) ids.add(image.id);
      }
    }
  return ids;
}

/** Keep references visible to tool-calling models, including ones without vision. */
export function withImageReferences(
  messages: UIMessage[],
  supportsImageInput: boolean,
): UIMessage[] {
  return messages.map((message) => {
    const references = message.parts.flatMap((part) => {
      if (part.type !== "file" || !part.mediaType.startsWith("image/"))
        return [];
      const match = /^\/api\/uploads\/([a-zA-Z0-9_-]+)$/.exec(part.url);
      return match
        ? [{ id: match[1], filename: part.filename ?? "image" }]
        : [];
    });
    if (!references.length) return message;
    return {
      ...message,
      parts: [
        ...message.parts.filter(
          (part) =>
            supportsImageInput ||
            part.type !== "file" ||
            !part.mediaType.startsWith("image/"),
        ),
        {
          type: "text" as const,
          text: `Attached image references (IDs for edit_image): ${JSON.stringify(references)}`,
        },
      ],
    };
  });
}

export function createImageTools({
  userId,
  messages,
  supportsImageInput,
  options,
  onGenerate,
}: {
  userId: string;
  messages: UIMessage[];
  supportsImageInput: boolean;
  options?: ImageGenerationOptions;
  onGenerate?: () => void;
}) {
  const allowedIds = referencedImageIds(messages);
  const generatedThisTurn = new Set<string>();
  let calls = 0;
  const fields = {
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(32_000)
      .describe("Describe the desired image or the requested changes."),
    size: z.enum(IMAGE_SIZES).optional(),
    quality: z.enum(IMAGE_QUALITIES).optional(),
  };
  async function execute(
    input: {
      prompt: string;
      image_ids?: string[];
      size?: ImageGenerationOptions["size"];
      quality?: ImageGenerationOptions["quality"];
    },
    signal?: AbortSignal,
  ): Promise<ImageGenerationOutput> {
    if (++calls > 4)
      throw new Error(
        "At most four image operations can run in one message. Send another message to continue.",
      );
    const connection = imageConnection();
    const referenceImageIds = input.image_ids ?? [];
    const references: Uint8Array[] = [];
    for (const id of referenceImageIds) {
      if (!allowedIds.has(id))
        throw new Error(
          "The reference image is not attached to this conversation.",
        );
      const image = await readFetchedImage(`/api/uploads/${id}`, userId);
      if (!image)
        throw new Error(
          "The reference image is unavailable. Attach it again before editing.",
        );
      references.push(image.data);
    }
    const size =
      options?.size !== undefined && options.size !== "auto"
        ? options.size
        : (input.size ?? DEFAULT_IMAGE_OPTIONS.size);
    const quality =
      connection.providerId === "google"
        ? "auto"
        : options?.quality !== undefined && options.quality !== "auto"
          ? options.quality
          : (input.quality ?? DEFAULT_IMAGE_OPTIONS.quality);
    onGenerate?.();
    const generated = await runImageProvider(
      connection,
      { prompt: input.prompt, references, size, quality },
      signal,
    );
    const filename = `generated-image.${generated.mediaType.split("/")[1].replace("jpeg", "jpg")}`;
    const { uploadUrl } = await storeFetchedImage({
      userId,
      filename,
      mediaType: generated.mediaType,
      data: generated.data,
    });
    const id = uploadUrl.split("/").at(-1)!;
    allowedIds.add(id);
    generatedThisTurn.add(id);
    return {
      images: [
        { id, url: uploadUrl, filename, mediaType: generated.mediaType },
      ],
      prompt: input.prompt,
      model: connection.model,
      size,
      quality,
      referenceImageIds,
      usage: generated.usage,
    };
  }
  const toModelOutput = async ({
    output,
  }: {
    output: ImageGenerationOutput;
  }) => {
    const images = Array.isArray(output?.images)
      ? output.images.filter(isGeneratedImage)
      : [];
    const content: Array<
      | { type: "text"; text: string }
      | {
          type: "file";
          mediaType: string;
          filename: string;
          data: { type: "data"; data: Uint8Array };
        }
    > = [
      {
        type: "text",
        text: JSON.stringify({
          images: images.map(({ id, filename }) => ({ id, filename })),
          prompt: output?.prompt,
          model: output?.model,
        }),
      },
    ];
    if (supportsImageInput)
      for (const image of images) {
        // Prior outputs retain IDs, without repeatedly charging for image context.
        if (!generatedThisTurn.has(image.id)) continue;
        const stored = await readFetchedImage(image.url, userId);
        if (stored)
          content.push({
            type: "file",
            mediaType: stored.mediaType,
            filename: stored.filename,
            data: { type: "data", data: stored.data },
          });
      }
    return { type: "content" as const, value: content };
  };
  return {
    generate_image: tool<
      {
        prompt: string;
        size?: ImageGenerationOptions["size"];
        quality?: ImageGenerationOptions["quality"];
      },
      ImageGenerationOutput,
      Record<string, never>
    >({
      description:
        "Create one new image from a text prompt. Use only when the user requests an image. Results appear in chat.",
      inputSchema: z.object(fields),
      execute: (input, { abortSignal }) => execute(input, abortSignal),
      toModelOutput,
    }),
    edit_image: tool<
      {
        prompt: string;
        image_ids: string[];
        size?: ImageGenerationOptions["size"];
        quality?: ImageGenerationOptions["quality"];
      },
      ImageGenerationOutput,
      Record<string, never>
    >({
      description:
        "Edit or combine attached or previously generated images. Use exact image IDs from the conversation. Produces one new image and preserves the originals.",
      inputSchema: z.object({
        ...fields,
        image_ids: z
          .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
          .min(1)
          .max(8),
      }),
      execute: (input, { abortSignal }) => execute(input, abortSignal),
      toModelOutput,
    }),
  };
}
