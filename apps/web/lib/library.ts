import type { AttachmentCategory } from "@/lib/chat/attachments";

export interface LibraryItem {
  id: string;
  url: string;
  filename: string;
  mediaType: string;
  category: AttachmentCategory;
  size: number;
  pageCount: number | null;
  truncated: boolean;
  createdAt: number;
}

export interface LibraryPage {
  items: LibraryItem[];
  nextCursor: string | null;
}

export interface LibraryCursor {
  createdAt: number;
  id: string;
}
