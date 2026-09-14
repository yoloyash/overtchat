import type { ToolState } from "./tools";

export const IMAGE_SIZES = [
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
] as const;
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export interface ImageGenerationOptions {
  size: ImageSize;
  quality: ImageQuality;
}
export const DEFAULT_IMAGE_OPTIONS: ImageGenerationOptions = {
  size: "auto",
  quality: "auto",
};
export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = {
  auto: "Auto",
  "1024x1024": "Square (1:1)",
  "1536x1024": "Landscape (3:2)",
  "1024x1536": "Portrait (2:3)",
};

export interface ImageCapability {
  supportsQuality?: boolean;
  available: boolean;
  model: string | null;
}

export interface GeneratedImage {
  id: string;
  url: string;
  mediaType: string;
  filename: string;
}

export interface ImageGenerationOutput extends ImageGenerationOptions {
  images: GeneratedImage[];
  prompt: string;
  model: string;
  referenceImageIds: string[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface ImageToolPart {
  type: "tool-generate_image" | "tool-edit_image";
  toolCallId: string;
  state: ToolState;
  input?: {
    prompt?: string;
    image_ids?: string[];
    size?: ImageSize;
    quality?: ImageQuality;
  };
  output?: ImageGenerationOutput;
  errorText?: string;
}

export function isImageToolPart(part: { type: string }): part is ImageToolPart {
  return part.type === "tool-generate_image" || part.type === "tool-edit_image";
}

/** Preserve the user's explicit image request when regenerating a whole reply. */
export function imageOptionsFromMetadata(
  metadata: unknown,
): ImageGenerationOptions | undefined {
  const saved =
    metadata && typeof metadata === "object"
      ? (metadata as { imageGeneration?: Partial<ImageGenerationOptions> })
          .imageGeneration
      : undefined;
  if (!saved || typeof saved !== "object") return undefined;
  const { size, quality } = saved;
  return {
    size: IMAGE_SIZES.includes(size as ImageSize)
      ? (size as ImageSize)
      : "auto",
    quality: IMAGE_QUALITIES.includes(quality as ImageQuality)
      ? (quality as ImageQuality)
      : "auto",
  };
}

/** Only render or reattach authenticated local image outputs. */
export function isGeneratedImage(image: unknown): image is GeneratedImage {
  if (!image || typeof image !== "object") return false;
  const value = image as Partial<GeneratedImage>;
  return (
    typeof value.id === "string" &&
    /^[a-zA-Z0-9_-]+$/.test(value.id) &&
    value.url === `/api/uploads/${value.id}` &&
    typeof value.filename === "string" &&
    ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
      value.mediaType ?? "",
    )
  );
}
