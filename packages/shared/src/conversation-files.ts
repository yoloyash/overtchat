import type { UIMessage } from "ai";
import {
  codeExecutionFiles,
  isCodeExecutionPart,
  type CodeExecutionFile,
} from "./code-execution";
import {
  isDocumentOutput,
  isDocumentToolPart,
  type DocumentVersion,
} from "./documents";
import { isGeneratedImage, isImageToolPart } from "./images";

/** A saved file the file panel can show. Attachments and generated images
 * have no recorded size. */
export type PanelFile = Omit<CodeExecutionFile, "size"> & { size?: number };

export type ConversationOutput =
  | { kind: "file"; file: PanelFile }
  | { kind: "document"; document: DocumentVersion };

export interface ConversationFiles {
  /** What the assistant made, most recent first: files from code runs and
   * documents at their latest version, and generated images. */
  outputs: ConversationOutput[];
  /** Files the user attached, most recent first. */
  uploads: PanelFile[];
}

const UPLOAD_URL = /^\/api\/uploads\/([a-zA-Z0-9_-]+)$/;

/** The files a conversation made or was given, for a list of its files. */
export function conversationFiles(messages: readonly UIMessage[]): ConversationFiles {
  const outputs = new Map<string, ConversationOutput>();
  const uploads = new Map<string, PanelFile>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "file") {
        const id = UPLOAD_URL.exec(part.url)?.[1];
        if (id) {
          uploads.set(id, {
            id,
            url: part.url,
            name: part.filename || "Attachment",
            mediaType: part.mediaType,
          });
        }
      } else if (isCodeExecutionPart(part)) {
        // A run's file replaces an earlier run's file of the same name and
        // moves up to where it was last saved.
        for (const file of codeExecutionFiles(part)) {
          const key = `run:${file.name.toLowerCase()}`;
          outputs.delete(key);
          outputs.set(key, { kind: "file", file });
        }
      } else if (
        isImageToolPart(part) &&
        part.state === "output-available" &&
        Array.isArray(part.output?.images)
      ) {
        for (const image of part.output.images) {
          if (!isGeneratedImage(image)) continue;
          outputs.set(`file:${image.id}`, {
            kind: "file",
            file: {
              id: image.id,
              url: image.url,
              name: image.filename,
              mediaType: image.mediaType,
            },
          });
        }
      } else if (
        isDocumentToolPart(part) &&
        part.state === "output-available" &&
        isDocumentOutput(part.output)
      ) {
        // A new version moves its document up to where it was last changed.
        const key = `document:${part.output.id}`;
        outputs.delete(key);
        outputs.set(key, {
          kind: "document",
          document: { ...part.output, messageId: message.id, toolCallId: part.toolCallId },
        });
      }
    }
  }
  return {
    outputs: [...outputs.values()].reverse(),
    uploads: [...uploads.values()].reverse(),
  };
}
