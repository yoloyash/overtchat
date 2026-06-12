const MIME_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/*",
];

const EXTENSION_ACCEPT = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
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
];

export const ATTACH_ACCEPT = [...MIME_ACCEPT, ...EXTENSION_ACCEPT].join(",");

const EXACT_MIME_ACCEPT = new Set(MIME_ACCEPT.filter((item) => !item.endsWith("/*")));
const EXTENSION_ACCEPT_SET = new Set(EXTENSION_ACCEPT);

export type AttachmentCategory = "image" | "document" | "text" | "spreadsheet";

export interface AttachmentMeta {
  category?: AttachmentCategory;
  size?: number;
  pageCount?: number | null;
  truncated?: boolean;
}

export function isSupportedAttachment(file: File): boolean {
  const mediaType = file.type.toLowerCase();
  if (EXACT_MIME_ACCEPT.has(mediaType)) return true;
  if (mediaType.startsWith("text/")) return true;

  const filename = file.name.toLowerCase();
  const dot = filename.lastIndexOf(".");
  if (dot >= 0 && EXTENSION_ACCEPT_SET.has(filename.slice(dot))) return true;

  return false;
}

export function unsupportedAttachmentMessage(file: File): string {
  const label = file.name || file.type || "This file";
  return `${label} is not a supported attachment type.`;
}

export function hasDataTransferFiles(data: DataTransfer): boolean {
  if (Array.from(data.types).includes("Files")) return true;
  return Array.from(data.items).some((item) => item.kind === "file");
}

interface WebKitEntry {
  isDirectory?: boolean;
}

type EntryItem = DataTransferItem & {
  webkitGetAsEntry?: () => WebKitEntry | null;
};

export function getDataTransferFiles(data: DataTransfer): File[] {
  if (data.items.length > 0) {
    return Array.from(data.items).flatMap((item) => {
      if (item.kind !== "file") return [];
      const entry = (item as EntryItem).webkitGetAsEntry?.();
      if (entry?.isDirectory) return [];
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  }

  return Array.from(data.files);
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
