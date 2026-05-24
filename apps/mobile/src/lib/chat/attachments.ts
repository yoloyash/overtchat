import type { UploadCategory } from "@/lib/api";

export type AttachmentCategory = UploadCategory;

export interface AttachmentMeta {
  category?: AttachmentCategory;
  size?: number;
  pageCount?: number | null;
  truncated?: boolean;
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
  if (mediaType === "text/csv") return "CSV";
  if (mediaType.startsWith("text/"))
    return mediaType.replace(/^text\//, "").toUpperCase();
  return mediaType;
}
