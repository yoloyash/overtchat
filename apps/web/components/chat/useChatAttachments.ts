"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FileUIPart } from "ai";
import {
  type AttachmentCategory,
  type AttachmentMeta,
  isSupportedAttachment,
  unsupportedAttachmentMessage,
} from "@/lib/chat/attachments";

export interface ChatAttachment {
  id: number;
  status: "uploading" | "ready" | "error";
  filename: string;
  mediaType: string;
  previewUrl?: string;
  part?: FileUIPart;
  meta?: AttachmentMeta;
  error?: string;
}

export function useChatAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  const nextIdRef = useRef(0);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        revokePreview(attachment);
      }
    },
    [],
  );

  const uploading = attachments.some((a) => a.status === "uploading");
  const readyParts = useMemo(
    () =>
      attachments
        .filter((a) => a.status === "ready" && a.part)
        .map((a) => a.part as FileUIPart),
    [attachments],
  );

  function addFiles(files: readonly File[]): void {
    for (const file of files) {
      if (!isSupportedAttachment(file)) {
        addRejectedFile(file);
        continue;
      }
      void uploadOne(file);
    }
  }

  function removeAttachment(id: number): void {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) revokePreview(target);
      return prev.filter((a) => a.id !== id);
    });
  }

  function clearAttachments(): void {
    setAttachments((prev) => {
      for (const attachment of prev) revokePreview(attachment);
      return [];
    });
  }

  function addRejectedFile(file: File): void {
    const id = nextIdRef.current++;
    setAttachments((prev) => [
      ...prev,
      {
        id,
        status: "error",
        filename: file.name || "file",
        mediaType: file.type || "application/octet-stream",
        error: unsupportedAttachmentMessage(file),
      },
    ]);
  }

  async function uploadOne(file: File): Promise<void> {
    const id = nextIdRef.current++;
    const isImage = file.type.startsWith("image/");
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
    setAttachments((prev) => [
      ...prev,
      {
        id,
        status: "uploading",
        previewUrl,
        filename: file.name || "file",
        mediaType: file.type || "application/octet-stream",
      },
    ]);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        mediaType?: string;
        filename?: string;
        category?: AttachmentCategory;
        size?: number;
        pageCount?: number | null;
        truncated?: boolean;
        error?: string;
      };
      if (!res.ok || !json.url || !json.mediaType) {
        throw new Error(json.error ?? `Upload failed (${res.status})`);
      }
      const part: FileUIPart = {
        type: "file",
        url: json.url,
        mediaType: json.mediaType,
        filename: json.filename,
      };
      const meta: AttachmentMeta = {
        category: json.category,
        size: json.size,
        pageCount: json.pageCount,
        truncated: json.truncated,
      };
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: "ready", part, meta } : a,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: "error", error: message } : a,
        ),
      );
    }
  }

  return {
    attachments,
    uploading,
    readyParts,
    addFiles,
    removeAttachment,
    clearAttachments,
  };
}

function revokePreview(attachment: ChatAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}
