import type { UIMessage } from "ai";
import {
  openUIActionOf,
  isActivityPart,
  isImageToolPart,
  isOpenUIToolPart,
  isMemoryToolPart,
  isManualCompactionMessage,
  isGeneratedImage,
  type GeneratedImage,
} from "@overtchat/shared";

export type { ChatShare, SharedConversation } from "@overtchat/shared";

/** Public rendering only. Shared images must never become private model inputs. */
export function isSharedGeneratedImage(
  image: unknown,
): image is GeneratedImage {
  if (!image || typeof image !== "object") return false;
  const value = image as Partial<GeneratedImage>;
  if (typeof value.url !== "string") return false;
  const match = /^\/api\/share\/[0-9a-f-]{36}\/files\/([a-zA-Z0-9_-]+)$/.exec(
    value.url,
  );
  return (
    !!match &&
    match[1] === value.id &&
    isGeneratedImage({ ...value, url: `/api/uploads/${value.id}` })
  );
}

/** Walk message content, including Markdown, tool results and OpenUI source. */
export function mapUploadReferences<T>(
  value: T,
  replace: (id: string) => string,
): T {
  function visit(item: unknown): unknown {
    if (typeof item === "string") {
      return item.replace(
        /\/api\/uploads\/([a-zA-Z0-9_-]+)/g,
        (_, id: string) => replace(id),
      );
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [key, visit(child)]),
      );
    }
    return item;
  }
  return visit(value) as T;
}

/** Keep visible content in its canonical format, excluding model replay metadata. */
export function sharedMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter(
      (message) =>
        message.role !== "system" && !isManualCompactionMessage(message),
    )
    .map((message) => {
      const action = openUIActionOf(message);
      return {
        id: message.id,
        role: message.role,
        ...(action?.formState
          ? {
              metadata: {
                openuiAction: {
                  messageId: action.messageId,
                  toolCallId: action.toolCallId,
                  message: action.message,
                  formState: action.formState,
                },
              },
            }
          : {}),
        parts: message.parts
          .filter(
            (part) =>
              [
                "text",
                "file",
                "source-url",
                "source-document",
                "step-start",
              ].includes(part.type) ||
              isActivityPart(part) ||
              isImageToolPart(part) ||
              isOpenUIToolPart(part) ||
              isMemoryToolPart(part),
          )
          .map(
            (part) =>
              Object.fromEntries(
                Object.entries(part).filter(([key]) =>
                  [
                    "type",
                    "text",
                    "state",
                    "url",
                    "mediaType",
                    "filename",
                    "sourceId",
                    "title",
                    "toolCallId",
                    "toolName",
                    "input",
                    "output",
                    "rawInput",
                    "errorText",
                  ].includes(key),
                ),
              ) as UIMessage["parts"][number],
          ),
      };
    });
}
