import type { Experimental_DownloadFunction, UIMessage } from "ai";
import { ChatRequestError } from "./request";

const UPLOAD_URL = /^\/api\/uploads\/[^/\\?#]+$/u;
const UNSUPPORTED_ATTACHMENT =
  "This chat contains an unsupported attachment URL. Edit the original message to remove it, or start a new chat and upload the file.";

/** Validate reconstructed history too, including attachments from imported chats. */
export function assertChatAttachments(messages: UIMessage[]): void {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        (part.type === "file" || part.type === "reasoning-file") &&
        !part.url.startsWith("data:") &&
        !(part.type === "file" && UPLOAD_URL.test(part.url))
      ) {
        throw new ChatRequestError(UNSUPPORTED_ATTACHMENT);
      }
    }
  }
}

// Owned uploads, inline data, and fetched-image tool results provide bytes. Prevent
// the SDK from fetching URLs in other file parts, including tool results, or
// forwarding those URLs to providers that support remote attachments.
export const rejectAttachmentDownloads: Experimental_DownloadFunction = async (downloads) => {
  if (downloads.length > 0) {
    throw new ChatRequestError(
      "A remote attachment URL cannot be sent to the model. Attachments and tool results must provide file data instead.",
    );
  }
  return [];
};
