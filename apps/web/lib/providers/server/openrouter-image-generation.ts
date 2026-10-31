import "server-only";
import type { ImageGenerationOptions } from "@overtchat/shared";
import {
  decodeImageData,
  imageMediaType,
  readImageUsage,
  readSingleImageItem,
} from "./custom-image-generation";
import type { ImageConnection, ReportedImageCost } from "./image-generation";

/** OpenRouter normalizes sizes to aspect ratios across its image providers. */
const ASPECT_RATIOS: Record<
  Exclude<ImageGenerationOptions["size"], "auto">,
  string
> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
};

/**
 * OpenRouter's dedicated images endpoint. Generation and editing share it, the
 * response carries the bytes inline, and usage reports the charge in USD.
 */
export async function runOpenRouterImageProvider(
  connection: ImageConnection,
  input: ImageGenerationOptions & { prompt: string; references: Uint8Array[] },
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  const body = {
    model: connection.model,
    prompt: input.prompt,
    n: 1,
    ...(input.size !== "auto"
      ? { aspect_ratio: ASPECT_RATIOS[input.size] }
      : {}),
    ...(input.quality !== "auto" ? { quality: input.quality } : {}),
    ...(input.references.length
      ? {
          input_references: input.references.map((data) => ({
            type: "image_url",
            image_url: {
              url: `data:${imageMediaType(data)};base64,${Buffer.from(data).toString("base64")}`,
            },
          })),
        }
      : {}),
  };
  const response = await fetcher(
    `${connection.baseUrl.replace(/\/+$/, "")}/images`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.apiKey ?? ""}`,
      },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    },
  );
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new Error(
      `Image provider request failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    );
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
  if (!("b64_json" in item) || typeof item.b64_json !== "string")
    throw new Error("The image provider did not return image data.");
  const declared =
    "media_type" in item && typeof item.media_type === "string"
      ? item.media_type
      : undefined;
  return {
    ...decodeImageData(item.b64_json, declared),
    usage: readImageUsage(payload as object),
    reportedCost: readReportedCost(payload as object),
  };
}

/** `usage.cost` is the account charge; the upstream prompt share splits it. */
function readReportedCost(payload: object): ReportedImageCost | undefined {
  const usage =
    "usage" in payload && isRecord(payload.usage) ? payload.usage : undefined;
  const total = nanoUsd(usage?.cost);
  if (total === undefined) return undefined;
  const details = isRecord(usage?.cost_details)
    ? usage.cost_details
    : undefined;
  const prompt = nanoUsd(details?.upstream_inference_prompt_cost) ?? 0;
  const inputCostNanoUsd = Math.min(prompt, total);
  return {
    inputCostNanoUsd,
    outputCostNanoUsd: total - inputCostNanoUsd,
    totalCostNanoUsd: total,
  };
}

function nanoUsd(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return undefined;
  const nano = Math.round(value * 1e9);
  return Number.isSafeInteger(nano) ? nano : undefined;
}

async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const json: unknown = JSON.parse((await response.text()).slice(0, 4096));
    const message =
      isRecord(json) && isRecord(json.error) ? json.error.message : undefined;
    return typeof message === "string" && message.trim()
      ? message.trim().slice(0, 200)
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
