import type { AttachmentCategory } from "@/lib/chat/attachments";

/** Reference files are the attachment types the model can read as text. */
export const MAX_PROJECT_FILES = 50;

export interface ProjectFileItem {
  uploadId: string;
  url: string;
  filename: string;
  mediaType: string;
  category: Exclude<AttachmentCategory, "image">;
  size: number;
  pageCount: number | null;
  truncated: boolean;
  /** When the file was added to the project. */
  addedAt: number;
  /** The chat that produced the file, when it was saved from one. */
  sourceChat: { id: string; title: string | null } | null;
}
