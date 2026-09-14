import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateImage, generateText } from "ai";
import type { ImageGenerationOptions } from "@overtchat/shared";
import { MAX_BYTES_IMAGE } from "@/lib/extract";
import { assertFetchedImageContent } from "@/lib/image-content";

export interface ImageConnection {
  providerId: "openai" | "google";
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

// Image responses contain base64. Bound the response before JSON parsing as
// well as checking the decoded image before it enters the upload store.
const MAX_RESPONSE_BYTES = Math.ceil((MAX_BYTES_IMAGE * 4) / 3) + 1024 * 1024;
class ImageResponseTooLargeError extends Error {}

const boundedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, redirect: "error" });
  let received = 0;
  const body = response.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_RESPONSE_BYTES)
          throw new ImageResponseTooLargeError(
            "The image provider response is too large.",
          );
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

/** One request, with image bytes supplied directly for edits. Never replay a paid operation. */
export async function runImageProvider(
  connection: ImageConnection,
  input: ImageGenerationOptions & { prompt: string; references: Uint8Array[] },
  signal?: AbortSignal,
) {
  const settings = {
    baseURL: connection.baseUrl.replace(/\/+$/, ""),
    apiKey: connection.apiKey ?? "",
    fetch: boundedFetch,
  };
  const abortSignal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(240_000),
  ]);
  try {
    const result =
      connection.providerId === "google"
        ? await generateText({
            // The SDK's image factory selects Imagen for IDs without "gemini-".
            // Select Gemini's generateContent API explicitly, including for aliases.
            model: createGoogleGenerativeAI(settings).chat(connection.model),
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: input.prompt },
                  ...input.references.map((data) => ({
                    type: "file" as const,
                    mediaType: "image",
                    data,
                  })),
                ],
              },
            ],
            providerOptions: {
              google: {
                responseModalities: ["IMAGE"],
                ...(input.size !== "auto"
                  ? {
                      imageConfig: {
                        aspectRatio: {
                          "1024x1024": "1:1",
                          "1536x1024": "3:2",
                          "1024x1536": "2:3",
                        }[input.size],
                      },
                    }
                  : {}),
              },
            },
            maxRetries: 0,
            abortSignal,
          }).then((result) => ({
            image: result.files.find((file) =>
              file.mediaType.startsWith("image/"),
            ),
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
            },
          }))
        : await generateImage({
            model: createOpenAI(settings).imageModel(connection.model),
            prompt: input.references.length
              ? { text: input.prompt, images: input.references }
              : input.prompt,
            n: 1,
            ...(input.size !== "auto" ? { size: input.size } : {}),
            providerOptions: {
              openai: {
                ...(input.quality !== "auto" ? { quality: input.quality } : {}),
              },
            },
            maxRetries: 0,
            abortSignal,
          }).then((result) => ({
            image: result.images[0],
            usage: result.usage,
          }));
    const image = result.image;
    if (!image) throw new Error("The image provider did not return an image.");
    if (image.uint8Array.byteLength > MAX_BYTES_IMAGE)
      throw new Error("The generated image exceeds the upload size limit.");
    assertFetchedImageContent(image.uint8Array, image.mediaType);
    return {
      data: image.uint8Array,
      mediaType: image.mediaType,
      usage: result.usage,
    };
  } catch (error) {
    if (signal?.aborted) throw new Error("Image generation stopped.");
    if (abortSignal.aborted)
      throw new Error(
        "Image generation timed out. Check the provider before retrying.",
      );
    let cause: unknown = error;
    for (
      let depth = 0;
      depth < 5 && cause instanceof Error;
      depth++, cause = cause.cause
    ) {
      if (cause instanceof ImageResponseTooLargeError) throw cause;
    }
    // Do not send SDK error objects (which include request details) to clients.
    let message =
      error instanceof Error ? error.message : "Image generation failed.";
    if (connection.apiKey)
      message = message.replaceAll(connection.apiKey, "[redacted]");
    throw new Error(message.slice(0, 500));
  }
}
