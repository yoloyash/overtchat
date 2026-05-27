import type { FileUIPart } from "ai";
import { useCallback, useRef, useState } from "react";
import { uploadFile } from "@/lib/api";
import type { AttachmentMeta } from "./attachments";

export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

export function useAttachments() {
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [attachmentMeta, setAttachmentMeta] = useState<
    Record<string, AttachmentMeta>
  >({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persistent cache of upload-url -> local picker URI. Survives clear() so
  // freshly-sent user message bubbles can keep rendering the local preview
  // instead of round-tripping to the auth-gated server endpoint.
  const localUriCacheRef = useRef<Record<string, string>>({});

  const getLocalUri = useCallback(
    (url: string) => localUriCacheRef.current[url],
    [],
  );

  const addFiles = useCallback(async (files: PickedFile[]) => {
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded: FileUIPart[] = [];
      const nextMeta: Record<string, AttachmentMeta> = {};
      for (const file of files) {
        const json = await uploadFile(file);
        uploaded.push({
          type: "file",
          url: json.url,
          mediaType: json.mediaType,
          filename: json.filename,
        });
        nextMeta[json.url] = {
          category: json.category,
          size: json.size,
          pageCount: json.pageCount,
          truncated: json.truncated,
          localUri: file.uri,
        };
        localUriCacheRef.current[json.url] = file.uri;
      }
      setAttachments((prev) => [...prev, ...uploaded]);
      setAttachmentMeta((prev) => ({ ...prev, ...nextMeta }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const remove = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (!removed) return prev;
      setAttachmentMeta((meta) => {
        const next = { ...meta };
        delete next[removed.url];
        return next;
      });
      delete localUriCacheRef.current[removed.url];
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
    setAttachmentMeta({});
    setError(null);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    attachments,
    attachmentMeta,
    uploading,
    error,
    addFiles,
    remove,
    clear,
    dismissError,
    getLocalUri,
  };
}
