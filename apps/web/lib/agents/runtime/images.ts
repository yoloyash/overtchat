import "server-only";
import fs from "node:fs/promises";
import {
  AGENT_IMAGE_MEDIA_TYPES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  type AgentPromptImage,
} from "@/lib/agents/types";
import type { ResolvedAgentImage } from "@/lib/agents/providers/types";
import { getUpload, uploadPath } from "@/lib/db/uploads";

const allowedMediaTypes = new Set<string>(AGENT_IMAGE_MEDIA_TYPES);

export async function resolveAgentImages(
  images: readonly AgentPromptImage[] | undefined,
  userId: string,
): Promise<ResolvedAgentImage[]> {
  if (!images?.length) return [];
  let totalBytes = 0;
  const resolved: ResolvedAgentImage[] = [];

  for (const image of images) {
    const upload = await getUpload(image.uploadId, userId);
    if (
      !upload ||
      upload.category !== "image" ||
      !allowedMediaTypes.has(upload.mediaType)
    ) {
      throw new Error("An attached image is unavailable.");
    }
    if (upload.size > MAX_AGENT_IMAGE_BYTES) {
      throw new Error("Agent images must be 10MB or smaller.");
    }
    totalBytes += upload.size;
    if (totalBytes > MAX_AGENT_IMAGE_TOTAL_BYTES) {
      throw new Error("Agent image attachments must total 20MB or less.");
    }
    const bytes = await fs.readFile(uploadPath(upload.id));
    resolved.push({
      uploadId: upload.id,
      filename: upload.filename,
      mediaType: upload.mediaType as AgentPromptImage["mediaType"],
      data: bytes.toString("base64"),
    });
  }

  return resolved;
}
