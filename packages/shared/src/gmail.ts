import type { ToolState } from "./tools";

/** Gmail tool names in deterministic provider order. */
export const GMAIL_TOOL_NAMES = [
  "gmail_search",
  "gmail_read_thread",
  "gmail_create_draft",
] as const;
export type GmailToolName = (typeof GMAIL_TOOL_NAMES)[number];

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  /** ISO 8601, from the time Gmail received the message. */
  date: string;
  snippet: string;
  unread: boolean;
}

export interface GmailSearchOutput {
  messages: GmailMessageSummary[];
  /** More messages match than were returned. */
  hasMore: boolean;
}

export interface GmailAttachment {
  filename: string;
  mediaType: string;
  size: number;
}

export interface GmailThreadMessage {
  id: string;
  from: string;
  to: string;
  cc?: string;
  date: string;
  subject: string;
  body: string;
  /** The body was cut to fit. */
  truncated: boolean;
  /** Names only. Attachment contents are not read. */
  attachments: GmailAttachment[];
}

export interface GmailThreadOutput {
  threadId: string;
  subject: string;
  /** Oldest first. */
  messages: GmailThreadMessage[];
  /** Earlier messages left out because the thread was too long. */
  omittedMessages: number;
}

export interface GmailDraftOutput {
  draftId: string;
  threadId: string | null;
  /** The mailbox the draft was saved in. */
  account: string;
  to: string;
  subject: string;
}

export type GmailToolPart = {
  type: `tool-${GmailToolName}`;
  toolCallId: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const GMAIL_PART_TYPES: ReadonlySet<string> = new Set(
  GMAIL_TOOL_NAMES.map((name) => `tool-${name}`),
);

export function isGmailToolPart(part: { type: string }): part is GmailToolPart {
  return GMAIL_PART_TYPES.has(part.type);
}

export interface GmailToolRow {
  /** Subject for a search result; sender for a message in a thread. */
  primary: string;
  /** Sender for a search result; attachment names for a thread message. */
  secondary?: string;
  /** ISO 8601. */
  date?: string;
  unread?: boolean;
}

/** What web and mobile show for one Gmail step, without any body text. */
export interface GmailToolDisplay {
  action: "search" | "read" | "draft";
  status: "running" | "done" | "error";
  title: string;
  /** The search query, thread subject, or draft subject. */
  detail?: string;
  /** A count or recipient, shown beside the title. */
  note?: string;
  rows: GmailToolRow[];
  /** Opens the saved draft's folder in Gmail. */
  href?: string;
  error?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const entry = record(item);
    if (entry) records.push(entry);
  }
  return records;
}

/** "Ada Lovelace <ada@example.com>" → "Ada Lovelace". */
export function gmailSenderName(from: string): string {
  const name = from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  return name || from.replace(/[<>]/g, "").trim();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Projects a saved or streaming Gmail tool call for display. It reads the
 * part defensively: saved history can predate the current output shape.
 */
export function describeGmailToolPart(part: GmailToolPart): GmailToolDisplay {
  const action =
    part.type === "tool-gmail_search"
      ? "search"
      : part.type === "tool-gmail_read_thread"
        ? "read"
        : "draft";
  const status =
    part.state === "output-error"
      ? "error"
      : part.state === "output-available"
        ? "done"
        : "running";
  const input = record(part.input);
  const output = status === "done" ? record(part.output) : undefined;
  const error =
    status === "error" ? (text(part.errorText) ?? "Gmail request failed") : undefined;

  if (action === "search") {
    const messages = list(output?.messages);
    return {
      action,
      status,
      title: status === "running" ? "Searching Gmail" : "Searched Gmail",
      detail: text(input?.query),
      note: output
        ? `${plural(messages.length, "result")}${output.hasMore === true ? "+" : ""}`
        : undefined,
      rows: messages.map((message) => ({
        primary: text(message.subject) ?? "(no subject)",
        secondary: gmailSenderName(text(message.from) ?? ""),
        date: text(message.date),
        unread: message.unread === true,
      })),
      error,
    };
  }

  if (action === "read") {
    const messages = list(output?.messages);
    return {
      action,
      status,
      title: status === "running" ? "Reading email" : "Read email",
      detail: text(output?.subject),
      note: output ? plural(messages.length, "message") : undefined,
      rows: messages.map((message) => {
        const attachments = list(message.attachments)
          .flatMap((attachment) => text(attachment.filename) ?? [])
          .join(", ");
        return {
          primary: gmailSenderName(text(message.from) ?? ""),
          secondary: attachments || undefined,
          date: text(message.date),
        };
      }),
      error,
    };
  }

  const account = text(output?.account);
  return {
    action,
    status,
    title: status === "running" ? "Writing draft" : "Saved draft in Gmail",
    detail: text(output?.subject) ?? text(input?.subject),
    note: text(output?.to) ? `To ${text(output?.to)}` : undefined,
    rows: [],
    href: output
      ? `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : ""}#drafts`
      : undefined,
    error,
  };
}

/** The activity timeline's one-line summary while or after a Gmail step runs. */
export function gmailActivityLabel(part: GmailToolPart, active: boolean): string {
  const display = describeGmailToolPart(part);
  if (active) {
    return display.action === "search" && display.detail
      ? `Searching Gmail for "${display.detail}"`
      : display.action === "search"
        ? "Searching Gmail…"
        : display.action === "read"
          ? "Reading email…"
          : "Writing draft…";
  }
  if (display.status === "error") return "Gmail request failed";
  if (display.status === "running") return "Gmail request did not complete";
  return display.title;
}
