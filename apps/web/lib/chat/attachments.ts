import type { TFunction } from "i18next";
import { i18n } from "@overtchat/shared/i18n";

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

/** Attachments the model reads as text: everything but images. */
export const DOCUMENT_ACCEPT = [
  ...MIME_ACCEPT.filter((item) => !item.startsWith("image/")),
  ...EXTENSION_ACCEPT,
].join(",");

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

export function isSupportedDocument(file: File): boolean {
  return isSupportedAttachment(file) && !file.type.toLowerCase().startsWith("image/");
}

export function unsupportedAttachmentMessage(file: File): string {
  const label = file.name || file.type || i18n.t("chat.files.thisFile");
  return i18n.t("chat.files.unsupportedAttachment", { label });
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
    const type = mediaType.slice(6).replace(/\+xml$/, "").toUpperCase();
    return t("chat.files.media.imageType", { type });
  }
  if (mediaType.startsWith("text/")) return mediaType.replace(/^text\/(x-)?/, "").toUpperCase();
  return mediaType;
}
