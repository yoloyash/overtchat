import type { UIMessage } from "ai";
import {
  STANDALONE_PATTERN,
  buildWebCitationIndex,
  isDocumentOutput,
  isDocumentToolPart,
  isImageToolPart,
  isManualCompactionMessage,
  isOpenUIToolPart,
  openUIFallbackText,
  stripCitationMarkers,
  type CitationRefType,
  type WebCitationIndex,
} from "@overtchat/shared";
import { parseMessageStats } from "@overtchat/shared/message-stats";
import type { ExportedChat, ExportedMessage } from "./index";

/**
 * The reader's time zone as their browser named it, or UTC when it is missing
 * or not a zone this server knows. The name is printed in the export, so it
 * is kept as sent rather than replaced by the runtime's canonical alias.
 */
export function exportTimeZone(candidate: string | null | undefined): string {
  const timeZone = candidate?.trim();
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** `2026-11-05 18:13` in the given zone, the same on every server locale. */
function formatTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** Keeps free text from ending the emphasis or link label it is placed in. */
function inline(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\*_[\]`]/g, "\\$&");
}

/** Escapes what would end a link destination early. */
function linkTarget(url: string): string {
  return url.replace(
    /[()<>\s]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/** Turns citation markers into numbered links that match the Sources list. */
function linkCitations(text: string, citations: WebCitationIndex): string {
  const linked = text.replace(
    new RegExp(`\\s*${STANDALONE_PATTERN.source}`, "g"),
    (marker, turn: string, refType: string, index: string) => {
      const cited = citations.resolve(
        Number(turn),
        refType as CitationRefType,
        Number(index),
      );
      // A marker with no known source is left for the cleanup below.
      return cited
        ? ` [${cited.number}](${linkTarget(cited.source.link)})`
        : marker;
    },
  );
  return stripCitationMarkers(linked);
}

/**
 * A message's readable content as Markdown blocks. Text is kept as written.
 * Attachments, generated images and documents become one-line notes, and
 * reasoning and tool activity are left out.
 */
function messageBlocks(message: ExportedMessage): string[] {
  const parts = Array.isArray(message.parts)
    ? (message.parts as UIMessage["parts"])
    : [];
  const citations = buildWebCitationIndex(parts);
  const blocks: string[] = [];
  let text = "";
  const endText = () => {
    const block = linkCitations(text, citations).trim();
    if (block) blocks.push(block);
    text = "";
  };

  for (const part of parts) {
    if (part.type === "text") {
      text += part.text;
      continue;
    }
    // Text on either side of a tool call or a new step is separate prose.
    endText();
    if (isOpenUIToolPart(part)) {
      blocks.push(openUIFallbackText(part).trim() || "*Interactive view*");
    } else if (part.type === "file") {
      blocks.push(`*Attachment: ${inline(part.filename ?? part.mediaType)}*`);
    } else if (isDocumentToolPart(part)) {
      if (part.state === "output-available" && isDocumentOutput(part.output)) {
        blocks.push(
          `*Document: ${inline(part.output.title)} (version ${part.output.version})*`,
        );
      }
    } else if (isImageToolPart(part)) {
      if (part.state === "output-available" && part.output) {
        blocks.push(`*Generated image: ${inline(part.output.prompt)}*`);
      }
    }
  }
  endText();

  if (blocks.length > 0 && citations.sources.length > 0) {
    blocks.push(
      [
        "**Sources**",
        "",
        ...citations.sources.map(
          (source, index) =>
            `${index + 1}. [${inline(source.title || source.link)}](${linkTarget(source.link)})`,
        ),
      ].join("\n"),
    );
  }
  return blocks;
}

/**
 * One chat as a Markdown document for reading and pasting elsewhere. It is
 * not an import format: the JSON export remains the complete copy.
 */
export function chatToMarkdown(
  chat: ExportedChat,
  { timeZone, exportedAt }: { timeZone: string; exportedAt: string },
): string {
  const sections = [
    `# ${inline(chat.title ?? "") || "Untitled chat"}`,
    `*Exported on ${formatTime(exportedAt, timeZone)}. Times are in ${timeZone}.*`,
  ];
  for (const message of chat.messages) {
    if (message.role === "system" || isManualCompactionMessage(message)) {
      continue;
    }
    const blocks = messageBlocks(message);
    if (blocks.length === 0) continue;
    const model =
      message.role === "assistant"
        ? parseMessageStats(message.metadata?.stats)?.model
        : undefined;
    sections.push(
      `## ${message.role === "user" ? "You" : "Assistant"}`,
      `*${[formatTime(message.createdAt, timeZone), model && inline(model)]
        .filter(Boolean)
        .join(" · ")}*`,
      ...blocks,
    );
  }
  return `${sections.join("\n\n")}\n`;
}
