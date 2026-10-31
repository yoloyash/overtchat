import "server-only";
import {
  customImageOptions,
  customImageSize,
} from "@/lib/model-config/image-options";
import { assertFetchedImageContent } from "@/lib/image-content";
import { MAX_BYTES_IMAGE } from "@/lib/extract";
import type { ImageConnection } from "./image-generation";

/** Synchronous OpenAI Images contract; never fetch provider-returned URLs. */
export async function runCustomImageProvider(
  connection: ImageConnection,
  input: { prompt: string; references: Uint8Array[] },
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  const options = customImageOptions(connection.providerOptions);
  if (input.references.length && !options.supportsEditing)
    throw new Error("This image provider does not support editing.");
  const size = customImageSize(options, input.references.length > 0);
  const body = {
    ...options.extraBody,
    model: connection.model,
    prompt: input.prompt,
    n: 1,
    ...(size === "auto" ? {} : { size }),
    response_format: options.responseFormat,
  };
  const headers: Record<string, string> = {};
  if (connection.apiKey?.trim())
    headers.Authorization = `Bearer ${connection.apiKey}`;
  let requestBody: BodyInit;
  if (input.references.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
      form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    for (const [index, data] of input.references.entries()) {
      const mediaType = imageMediaType(data);
      form.append(
        "image[]",
        new Blob([Buffer.from(data)], { type: mediaType }),
        `reference-${index}.${mediaType.split("/")[1]}`,
      );
    }
    requestBody = form;
  } else {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const response = await fetcher(
    `${connection.baseUrl.replace(/\/+$/, "")}/images/${input.references.length ? "edits" : "generations"}`,
    { method: "POST", headers, body: requestBody, signal, redirect: "error" },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Image provider request failed (HTTP ${response.status}).`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("The image provider returned invalid JSON.");
    throw error;
  }
  const item = readSingleImageItem(payload);
  let encoded: string;
  let declaredMediaType: string | undefined;
  if ("b64_json" in item && typeof item.b64_json === "string") {
    encoded = item.b64_json;
  } else if ("url" in item && typeof item.url === "string") {
    const match =
      /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        item.url,
      );
    if (!match)
      throw new Error(
        "The image provider must return base64 image data or an inline image data URL.",
      );
    [, declaredMediaType, encoded] = match;
  } else throw new Error("The image provider did not return image data.");
  return {
    ...decodeImageData(encoded, declaredMediaType),
    usage: readImageUsage(payload as object),
    reportedCost: undefined,
  };
}

/** The one `data` item of an Images-style response; never more than one. */
export function readSingleImageItem(payload: unknown): object {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    !Array.isArray(payload.data) ||
    payload.data.length !== 1
  )
    throw new Error("The image provider must return exactly one image.");
  const item: unknown = payload.data[0];
  if (!item || typeof item !== "object")
    throw new Error("The image provider did not return an image.");
  return item;
}

/** Decodes base64 image bytes, bounding size and checking the raster signature. */
export function decodeImageData(encoded: string, declaredMediaType?: string) {
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error("The image provider returned invalid base64 data.");
  if (encoded.length > Math.ceil(MAX_BYTES_IMAGE / 3) * 4)
    throw new Error("The generated image exceeds the upload size limit.");
  const data = Buffer.from(encoded, "base64");
  if (data.byteLength > MAX_BYTES_IMAGE)
    throw new Error("The generated image exceeds the upload size limit.");
  const mediaType = imageMediaType(data);
  if (declaredMediaType && mediaType !== declaredMediaType)
    throw new Error("The image provider returned mismatched image content.");
  return { data, mediaType };
}

/**
 * Token usage from an OpenAI Images response. Gateways that proxy image
 * models through chat billing report the chat field names instead.
 */
export function readImageUsage(payload: object) {
  const usage =
    "usage" in payload &&
    payload.usage &&
    typeof payload.usage === "object" &&
    !Array.isArray(payload.usage)
      ? (payload.usage as Record<string, unknown>)
      : undefined;
  if (!usage) return undefined;
  const count = (...keys: string[]) => {
    for (const key of keys) {
      const value = usage[key];
      if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
      )
        return value;
    }
    return undefined;
  };
  const inputTokens = count("input_tokens", "prompt_tokens");
  const outputTokens = count("output_tokens", "completion_tokens");
  const totalTokens =
    count("total_tokens") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  )
    return undefined;
  return { inputTokens, outputTokens, totalTokens };
}

export function imageMediaType(data: Uint8Array): string {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
    try {
      assertFetchedImageContent(data, type);
      return type;
    } catch {
      /* Try the next supported signature. */
    }
  }
  throw new Error("The image provider returned unsupported image content.");
}
