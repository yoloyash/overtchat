import type { ToolState } from "./tools";

/** Gmail tool names in deterministic provider order. */
export const GMAIL_TOOL_NAMES = [
  "gmail_search",
  "gmail_read_thread",
  "gmail_read_attachment",
  "gmail_list_labels",
  "gmail_modify_labels",
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
  /** The mailbox that was searched. */
  account: string;
  messages: GmailMessageSummary[];
  /** More messages match than were returned. */
  hasMore: boolean;
}

export interface GmailAttachment {
  /** Names the attachment within its message, for gmail_read_attachment. */
  id: string;
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
  /** Listed only. gmail_read_attachment reads one. */
  attachments: GmailAttachment[];
}

export interface GmailThreadOutput {
  /** The mailbox the thread was read from. */
  account: string;
  threadId: string;
  subject: string;
  /** Oldest first. */
  messages: GmailThreadMessage[];
  /** Earlier messages left out because the thread was too long. */
  omittedMessages: number;
}

export interface GmailAttachmentOutput {
  messageId: string;
  filename: string;
  mediaType: string;
  /** The file's text from `offset`, as much as fits in one result. */
  text: string;
  offset: number;
  /** Characters in the whole file's text. */
  totalChars: number;
  /** Where the next part starts, or null when this was the last. */
  nextOffset: number | null;
  pageCount: number | null;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
}

export interface GmailLabelsOutput {
  labels: GmailLabel[];
}

export interface GmailModifyLabelsOutput {
  /** The mailbox that was changed. */
  account: string;
  /** How many threads were changed. */
  threads: number;
  /** Label names, with Gmail's own labels in capitals (INBOX, UNREAD). */
  added: string[];
  removed: string[];
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

/** One message in a Gmail step: a search result, or a message of a thread. */
export interface GmailToolRow {
  sender: string;
  /** A search result's subject. */
  subject?: string;
  /** Names of the files attached to a message that was read. */
  attachments?: string[];
  /** ISO 8601. */
  date?: string;
  unread?: boolean;
  /** Opens the message's thread in Gmail. */
  href?: string;
}

/** What web and mobile show for one Gmail step, without any body text. */
export interface GmailToolDisplay {
  action: "search" | "read" | "attachment" | "labels" | "sort" | "draft";
  status: "running" | "done" | "error";
  title: string;
  /** The search query, thread subject, file name, or draft subject. */
  detail?: string;
  /** A count or the changes made, shown beside the detail. */
  note?: string;
  /** Who a draft is addressed to. */
  recipient?: string;
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
  const name = from
    .replace(/<[^>]*>/g, "")
    .trim()
    // Mailing lists quote the original sender: 'Ada' via Some List.
    .replace(/^(["'])(.*?)\1/, "$2")
    .replace(/"/g, "")
    .trim();
  return name || from.replace(/[<>]/g, "").trim();
}

function count(total: number, noun: string, more = false): string {
  if (total === 0) return `No ${noun}s`;
  return `${total}${more ? "+" : ""} ${noun}${total === 1 && !more ? "" : "s"}`;
}

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => text(item) ?? [])
    : [];
}

/** What a change of labels did, in the words Gmail's own buttons use. */
function sortingChanges(added: string[], removed: string[]): string[] {
  const changes: string[] = [];
  const system: Record<string, [added: string, removed: string]> = {
    INBOX: ["moved to inbox", "archived"],
    UNREAD: ["marked unread", "marked read"],
    STARRED: ["starred", "unstarred"],
    IMPORTANT: ["marked important", "marked not important"],
  };
  for (const [label, [whenAdded, whenRemoved]] of Object.entries(system)) {
    if (removed.includes(label)) changes.push(whenRemoved);
    if (added.includes(label)) changes.push(whenAdded);
  }
  for (const label of added) {
    if (!(label in system)) changes.push(`labeled ${label}`);
  }
  for (const label of removed) {
    if (!(label in system)) changes.push(`unlabeled ${label}`);
  }
  return changes;
}

function gmailUrl(account: string | undefined, fragment: string): string {
  return `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : ""}#${fragment}`;
}

/**
 * Gmail opens the first signed-in account unless told which, so a thread is
 * linked only when its mailbox is known.
 */
function gmailThreadUrl(
  account: string | undefined,
  threadId: string | undefined,
): string | undefined {
  return account && threadId && /^[A-Za-z0-9_-]+$/.test(threadId)
    ? gmailUrl(account, `all/${threadId}`)
    : undefined;
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
        : part.type === "tool-gmail_read_attachment"
          ? "attachment"
          : part.type === "tool-gmail_list_labels"
            ? "labels"
            : part.type === "tool-gmail_modify_labels"
              ? "sort"
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

  const account = text(output?.account);

  if (action === "search") {
    const messages = list(output?.messages);
    return {
      action,
      status,
      title: status === "running" ? "Searching Gmail" : "Searched Gmail",
      detail: text(input?.query),
      note: output
        ? count(messages.length, "result", output.hasMore === true)
        : undefined,
      rows: messages.map((message) => ({
        sender: gmailSenderName(text(message.from) ?? ""),
        subject: text(message.subject) ?? "(no subject)",
        date: text(message.date),
        unread: message.unread === true,
        href: gmailThreadUrl(account, text(message.threadId)),
      })),
      error,
    };
  }

  if (action === "read") {
    const messages = list(output?.messages);
    const href = gmailThreadUrl(account, text(output?.threadId));
    return {
      action,
      status,
      title: status === "running" ? "Reading email" : "Read email",
      detail: text(output?.subject),
      note: output ? count(messages.length, "message") : undefined,
      rows: messages.map((message) => {
        const attachments = list(message.attachments).flatMap(
          (attachment) => text(attachment.filename) ?? [],
        );
        return {
          sender: gmailSenderName(text(message.from) ?? ""),
          attachments: attachments.length > 0 ? attachments : undefined,
          date: text(message.date),
          href,
        };
      }),
      error,
    };
  }

  if (action === "attachment") {
    const pages = typeof output?.pageCount === "number" ? output.pageCount : 0;
    const offset = typeof output?.offset === "number" ? output.offset : 0;
    return {
      action,
      status,
      title: status === "running" ? "Reading attachment" : "Read attachment",
      detail: text(output?.filename),
      note: output
        ? offset > 0
          ? "Continued"
          : pages > 0
            ? count(pages, "page")
            : undefined
        : undefined,
      rows: [],
      error,
    };
  }

  if (action === "labels") {
    return {
      action,
      status,
      title: status === "running" ? "Listing Gmail labels" : "Listed Gmail labels",
      note: output ? count(list(output.labels).length, "label") : undefined,
      rows: [],
      error,
    };
  }

  if (action === "sort") {
    const changes = sortingChanges(names(output?.added), names(output?.removed));
    const threads = typeof output?.threads === "number" ? output.threads : 0;
    const conversations = count(threads, "conversation");
    const summary = changes.join(", ");
    return {
      action,
      status,
      title:
        status !== "done"
          ? "Sorting mail"
          : `${conversations} ${changes.length === 1 ? changes[0] : "updated"}`,
      note:
        changes.length > 1
          ? `${summary[0].toUpperCase()}${summary.slice(1)}`
          : undefined,
      rows: [],
      error,
    };
  }

  return {
    action,
    status,
    title: status === "running" ? "Writing draft" : "Saved draft in Gmail",
    detail: text(output?.subject) ?? text(input?.subject),
    recipient: text(output?.to),
    rows: [],
    href: output ? gmailUrl(account, "drafts") : undefined,
    error,
  };
}

const ACTIVE_LABELS: Record<GmailToolDisplay["action"], string> = {
  search: "Searching Gmail…",
  read: "Reading email…",
  attachment: "Reading attachment…",
  labels: "Listing Gmail labels…",
  sort: "Sorting mail…",
  draft: "Writing draft…",
};

/** The activity timeline's one-line summary while or after a Gmail step runs. */
export function gmailActivityLabel(part: GmailToolPart, active: boolean): string {
  const display = describeGmailToolPart(part);
  if (active) {
    return display.action === "search" && display.detail
      ? `Searching Gmail for "${display.detail}"`
      : ACTIVE_LABELS[display.action];
  }
  if (display.status === "error") return "Gmail request failed";
  if (display.status === "running") return "Gmail request did not complete";
  return display.title;
}
