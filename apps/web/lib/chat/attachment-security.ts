import type { Experimental_DownloadFunction, UIMessage } from "ai";
import { ChatRequestError } from "./request";

const UPLOAD_URL = /^\/api\/uploads\/[^/\\?#]+$/u;
const UPLOAD_REQUIRED = "This chat contains an unsupported attachment. Upload the file again to continue.";

/** Validate reconstructed history too, including attachments from imported chats. */
export function assertUploadedAttachments(messages: UIMessage[]): void {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === "reasoning-file" ||
        (part.type === "file" && !UPLOAD_URL.test(part.url))
      ) {
        throw new ChatRequestError(UPLOAD_REQUIRED);
      }
    }
  }
}

// Owned uploads and fetched-image tool results already provide bytes. Prevent
// the SDK from fetching URLs in other file parts, including tool results, or
// forwarding those URLs to providers that support remote attachments.
export const rejectAttachmentDownloads: Experimental_DownloadFunction = async (downloads) => {
  if (downloads.length > 0) throw new ChatRequestError(UPLOAD_REQUIRED);
  return [];
};
