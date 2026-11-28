import type { UploadCategory } from "@/lib/api";
import type { TFunction } from "i18next";

export type AttachmentCategory = UploadCategory;

export interface AttachmentMeta {
  category?: AttachmentCategory;
  size?: number;
  pageCount?: number | null;
  truncated?: boolean;
  /** Local file URI from the picker; used for instant preview before/after upload. */
  localUri?: string;
}

export function formatSize(bytes: number, t: TFunction): string {
  if (bytes < 1024) return t("chat.files.sizeBytes", { size: bytes });
  if (bytes < 1024 * 1024) {
    return t("chat.files.sizeKb", { size: (bytes / 1024).toFixed(1) });
  }
  return t("chat.files.sizeMb", {
    size: (bytes / 1024 / 1024).toFixed(1),
  });
}

export function humanMediaLabel(
  mediaType: string | undefined,
  t: TFunction,
): string {
  if (!mediaType) return t("chat.files.media.file");
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType.includes("wordprocessingml")) {
    return t("chat.files.media.word");
  }
  if (mediaType.includes("spreadsheetml")) {
    return t("chat.files.media.excel");
  }
  if (mediaType.includes("presentationml")) {
    return t("chat.files.media.powerpoint");
  }
  if (mediaType === "text/csv") return "CSV";
  if (mediaType === "application/json") return "JSON";
  if (mediaType === "application/zip") return t("chat.files.media.zip");
  if (mediaType === "application/octet-stream") {
    return t("chat.files.media.file");
  }
  if (mediaType.startsWith("image/")) {
    return t("chat.files.media.imageType", {
      type: mediaType.slice(6).replace(/\+xml$/, "").toUpperCase(),
    });
  }
  if (mediaType.startsWith("text/"))
    return mediaType.replace(/^text\/(x-)?/, "").toUpperCase();
  return mediaType;
}
