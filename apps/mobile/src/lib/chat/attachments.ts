import type { UploadCategory } from "@/lib/api";

export type AttachmentCategory = UploadCategory;

export interface AttachmentMeta {
  category?: AttachmentCategory;
  size?: number;
  pageCount?: number | null;
  truncated?: boolean;
  /** Local file URI from the picker; used for instant preview before/after upload. */
  localUri?: string;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function humanMediaLabel(mediaType: string | undefined): string {
  if (!mediaType) return "File";
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType.includes("wordprocessingml")) return "Word document";
  if (mediaType.includes("spreadsheetml")) return "Excel spreadsheet";
  if (mediaType.includes("presentationml")) return "PowerPoint presentation";
  if (mediaType === "text/csv") return "CSV";
  if (mediaType === "application/json") return "JSON";
  if (mediaType === "application/zip") return "ZIP archive";
  if (mediaType === "application/octet-stream") return "File";
  if (mediaType.startsWith("image/")) {
    return `${mediaType.slice(6).replace(/\+xml$/, "").toUpperCase()} image`;
  }
  if (mediaType.startsWith("text/"))
    return mediaType.replace(/^text\/(x-)?/, "").toUpperCase();
  return mediaType;
}
