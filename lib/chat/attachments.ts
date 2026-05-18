export const ATTACH_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/*",
  ".md",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".sh",
  ".sql",
].join(",");

export type AttachmentCategory = "image" | "document" | "text" | "spreadsheet";

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
  if (mediaType.startsWith("text/")) return mediaType.replace(/^text\//, "").toUpperCase();
  return mediaType;
}
