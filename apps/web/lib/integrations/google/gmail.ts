import "server-only";
import { parseHTML } from "linkedom";
import type {
  GmailAttachment,
  GmailAttachmentOutput,
  GmailDraftOutput,
  GmailLabel,
  GmailLabelsOutput,
  GmailMessageSummary,
  GmailModifyLabelsOutput,
  GmailSearchOutput,
  GmailThreadMessage,
  GmailThreadOutput,
} from "@overtchat/shared";
import { getIntegrationConnection } from "@/lib/db/integrations";
import {
  discardIntegrationAccessToken,
  getIntegrationAccessToken,
} from "@/lib/integrations/connections";
import {
  IntegrationError,
  IntegrationReconnectError,
} from "@/lib/integrations/errors";
import { googleUrl } from "@/lib/integrations/google/oauth";
import { ExtractionError, MAX_BYTES_DOC, extractFile } from "@/lib/extract";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const REQUEST_TIMEOUT_MS = 20_000;

/** One message's share of a thread, and the whole thread's, in characters. */
const MAX_MESSAGE_CHARS = 20_000;
const MAX_THREAD_CHARS = 60_000;

/** How much of an attachment's text one result carries. */
const MAX_ATTACHMENT_CHARS = 60_000;

/** Threads changed at once, within Gmail's per-user rate limit. */
const MODIFY_CONCURRENCY = 5;

interface GmailApiHeader {
  name?: string;
  value?: string;
}

interface GmailApiPart {
  /** Position in the message, such as "1" or "0.2". Stable, unlike `attachmentId`. */
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailApiHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailApiPart[];
}

interface GmailApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiPart;
}

/** Read by the person in a failed step and by the model, which passes it on. */
export const GMAIL_RECONNECT_MESSAGE =
  "The Gmail sign-in has ended. Reconnect Gmail in the OvertChat web app under Settings → Tools → Connectors.";

async function gmailAccessToken(userId: string): Promise<string> {
  try {
    return await getIntegrationAccessToken(userId, "gmail");
  } catch (error) {
    if (error instanceof IntegrationReconnectError) {
      throw new IntegrationReconnectError(GMAIL_RECONNECT_MESSAGE);
    }
    throw error;
  }
}

async function gmailRequest<T>(
  userId: string,
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  // A token Google refuses is refreshed once: the grant may still be good.
  for (let attempt = 0; ; attempt += 1) {
    const accessToken = await gmailAccessToken(userId);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(googleUrl(`${GMAIL_API}${path}`), {
        method: options.body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal
          ? AbortSignal.any([timeout, options.signal])
          : timeout,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new IntegrationError("Could not reach Gmail. Try again.", 502);
    }
    if (response.status === 401 && attempt === 0) {
      discardIntegrationAccessToken(userId, "gmail", accessToken);
      continue;
    }
    if (!response.ok) throw await gmailError(response);
    return (await response.json()) as T;
  }
}

async function gmailError(response: Response): Promise<IntegrationError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  const detail =
    typeof body?.error?.message === "string" ? body.error.message : "";
  if (response.status === 404) {
    return new IntegrationError("Gmail has no message or thread with that ID.", 404);
  }
  if (response.status === 429) {
    return new IntegrationError(
      "Gmail is limiting requests for this account. Try again in a minute.",
      429,
    );
  }
  if (response.status === 403) {
    return new IntegrationError(
      `Gmail refused the request${detail ? `: ${detail}` : "."}`,
      403,
    );
  }
  return new IntegrationError(
    `Gmail returned an error${detail ? `: ${detail}` : "."}`,
    502,
  );
}

function header(part: GmailApiPart | undefined, name: string): string {
  const wanted = name.toLowerCase();
  return (
    part?.headers?.find((item) => item.name?.toLowerCase() === wanted)?.value ??
    ""
  );
}

function receivedAt(message: GmailApiMessage): string {
  const received = Number(message.internalDate);
  return Number.isFinite(received) && received > 0
    ? new Date(received).toISOString()
    : "";
}

/** The address results are labeled with, so links open the right mailbox. */
function mailbox(userId: string): string {
  return getIntegrationConnection(userId, "gmail")?.accountEmail ?? "";
}

const SUMMARY_HEADERS = ["From", "To", "Subject", "Date"];

function metadataQuery(headers: string[]): string {
  const query = new URLSearchParams({ format: "metadata" });
  for (const name of headers) query.append("metadataHeaders", name);
  return query.toString();
}

export async function searchGmail(
  userId: string,
  input: { query: string; limit: number },
  signal?: AbortSignal,
): Promise<GmailSearchOutput> {
  const listed = await gmailRequest<{
    messages?: { id: string }[];
    nextPageToken?: string;
  }>(
    userId,
    `/messages?${new URLSearchParams({
      q: input.query,
      maxResults: String(input.limit),
    })}`,
    { signal },
  );
  const messages = await Promise.all(
    (listed.messages ?? []).map(({ id }) =>
      gmailRequest<GmailApiMessage>(
        userId,
        `/messages/${encodeURIComponent(id)}?${metadataQuery(SUMMARY_HEADERS)}`,
        { signal },
      ),
    ),
  );
  return {
    account: mailbox(userId),
    messages: messages.map(
      (message): GmailMessageSummary => ({
        id: message.id,
        threadId: message.threadId,
        from: header(message.payload, "From"),
        to: header(message.payload, "To"),
        subject: header(message.payload, "Subject"),
        date: receivedAt(message),
        snippet: decodeEntities(message.snippet ?? ""),
        unread: message.labelIds?.includes("UNREAD") ?? false,
      }),
    ),
    hasMore: Boolean(listed.nextPageToken),
  };
}

/** Gmail escapes its snippets as HTML. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function decodeBody(part: GmailApiPart): string {
  const data = part.body?.data;
  if (!data) return "";
  const bytes = Buffer.from(data, "base64url");
  const charset = /charset="?([^";\s]+)/i.exec(header(part, "Content-Type"))?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

const BLOCK_ELEMENTS =
  "address,article,blockquote,br,div,dd,dt,h1,h2,h3,h4,h5,h6,hr,li,p,pre,section,table,tr";

/** Readable text from an HTML-only message, one line per block element. */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const element of document.querySelectorAll("script,style,head,title")) {
    element.remove();
  }
  for (const element of document.querySelectorAll(BLOCK_ELEMENTS)) {
    element.after(document.createTextNode("\n"));
  }
  return collapseWhitespace(document.body.textContent ?? "");
}

function collapseWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(part: GmailApiPart | undefined, visit: (part: GmailApiPart) => void) {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) walk(child, visit);
}

/** The message's text, preferring a plain-text part over an HTML one. */
function messageBody(payload: GmailApiPart | undefined): string {
  let plain: GmailApiPart | undefined;
  let html: GmailApiPart | undefined;
  walk(payload, (part) => {
    if (part.filename || !part.body?.data) return;
    if (part.mimeType === "text/plain") plain ??= part;
    else if (part.mimeType === "text/html") html ??= part;
  });
  if (plain) return collapseWhitespace(decodeBody(plain));
  return html ? htmlToText(decodeBody(html)) : "";
}

function messageAttachments(payload: GmailApiPart | undefined): GmailAttachment[] {
  const attachments: GmailAttachment[] = [];
  walk(payload, (part) => {
    if (!part.filename || !part.partId) return;
    attachments.push({
      id: part.partId,
      filename: part.filename,
      mediaType: part.mimeType ?? "application/octet-stream",
      size: part.body?.size ?? 0,
    });
  });
  return attachments;
}

export async function readGmailThread(
  userId: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<GmailThreadOutput> {
  const thread = await gmailRequest<{ id: string; messages?: GmailApiMessage[] }>(
    userId,
    `/threads/${encodeURIComponent(threadId)}?format=full`,
    { signal },
  );
  const all = thread.messages ?? [];

  // The newest messages matter most, so an overlong thread loses its oldest.
  const kept: GmailThreadMessage[] = [];
  let remaining = MAX_THREAD_CHARS;
  for (const message of [...all].reverse()) {
    if (remaining <= 0) break;
    const body = messageBody(message.payload);
    const limit = Math.min(MAX_MESSAGE_CHARS, remaining);
    const cc = header(message.payload, "Cc");
    kept.unshift({
      id: message.id,
      from: header(message.payload, "From"),
      to: header(message.payload, "To"),
      ...(cc ? { cc } : {}),
      date: receivedAt(message),
      subject: header(message.payload, "Subject"),
      body: body.slice(0, limit),
      truncated: body.length > limit,
      attachments: messageAttachments(message.payload),
    });
    remaining -= Math.min(body.length, limit);
  }

  return {
    account: mailbox(userId),
    threadId: thread.id,
    subject: header(all[0]?.payload, "Subject"),
    messages: kept,
    omittedMessages: all.length - kept.length,
  };
}

/** File types mail clients often send as a bare "octet-stream". */
const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
};

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The text of one attached file. Gmail's own attachment IDs change with every
 * request, so the file is named by its position in the message.
 */
export async function readGmailAttachment(
  userId: string,
  input: { messageId: string; attachmentId: string; offset: number },
  signal?: AbortSignal,
): Promise<GmailAttachmentOutput> {
  const message = await gmailRequest<GmailApiMessage>(
    userId,
    `/messages/${encodeURIComponent(input.messageId)}?format=full`,
    { signal },
  );
  let part: GmailApiPart | undefined;
  walk(message.payload, (candidate) => {
    if (candidate.filename && candidate.partId === input.attachmentId) {
      part ??= candidate;
    }
  });
  if (!part?.filename) {
    throw new IntegrationError(
      "That message has no attachment with that ID. Read its thread again for the current list.",
      404,
    );
  }
  const filename = part.filename;
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const declared = (part.mimeType ?? "").toLowerCase();
  const mediaType =
    !declared || declared === "application/octet-stream"
      ? (MEDIA_TYPE_BY_EXTENSION[extension] ?? declared)
      : declared;

  // Refuse before downloading anything that could not be read anyway.
  if (mediaType.startsWith("image/")) {
    throw new IntegrationError(
      `${filename} is an image. Attached images cannot be read.`,
      415,
    );
  }
  const size = part.body?.size ?? 0;
  if (size > MAX_BYTES_DOC) {
    throw new IntegrationError(
      `${filename} is ${megabytes(size)}. Attachments over ${megabytes(MAX_BYTES_DOC)} cannot be read.`,
      413,
    );
  }

  let data = part.body?.data;
  if (!data && part.body?.attachmentId) {
    const attachment = await gmailRequest<{ data?: string }>(
      userId,
      `/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
      { signal },
    );
    data = attachment.data;
  }
  const buffer = Buffer.from(data ?? "", "base64url");
  if (buffer.length === 0) {
    throw new IntegrationError(`${filename} is empty.`, 422);
  }
  if (buffer.length > MAX_BYTES_DOC) {
    throw new IntegrationError(
      `${filename} is ${megabytes(buffer.length)}. Attachments over ${megabytes(MAX_BYTES_DOC)} cannot be read.`,
      413,
    );
  }

  let extracted;
  try {
    extracted = await extractFile({ buffer, filename, mediaType });
  } catch (error) {
    if (error instanceof ExtractionError) {
      throw new IntegrationError(
        error.status === 415
          ? `${filename} is a kind of file that cannot be read. PDF, Word, spreadsheet, CSV and text files can.`
          : `${filename}: ${error.message}`,
        error.status,
      );
    }
    throw error;
  }
  const text = extracted.text ?? "";
  if (input.offset > 0 && input.offset >= text.length) {
    throw new IntegrationError(
      `${filename} has ${text.length} characters of text; there is nothing at offset ${input.offset}.`,
      400,
    );
  }
  const end = Math.min(text.length, input.offset + MAX_ATTACHMENT_CHARS);
  return {
    messageId: message.id,
    filename,
    mediaType: extracted.mediaType,
    text: text.slice(input.offset, end),
    offset: input.offset,
    totalChars: text.length,
    nextOffset: end < text.length ? end : null,
    pageCount: extracted.pageCount,
  };
}

interface GmailApiLabel {
  id: string;
  name?: string;
  type?: string;
}

/** Gmail's own labels that sorting mail may add or remove. */
const SORTING_LABELS = ["INBOX", "UNREAD", "STARRED", "IMPORTANT"];

async function fetchLabels(
  userId: string,
  signal?: AbortSignal,
): Promise<GmailApiLabel[]> {
  const listed = await gmailRequest<{ labels?: GmailApiLabel[] }>(
    userId,
    "/labels",
    { signal },
  );
  return listed.labels ?? [];
}

/** The labels a model may apply: the user's own, and the few that sort mail. */
export async function listGmailLabels(
  userId: string,
  signal?: AbortSignal,
): Promise<GmailLabelsOutput> {
  const labels = await fetchLabels(userId, signal);
  const user = labels
    .filter((label) => label.type === "user")
    .map((label): GmailLabel => ({
      id: label.id,
      name: label.name ?? label.id,
      type: "user",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    labels: [
      ...SORTING_LABELS.map((id): GmailLabel => ({ id, name: id, type: "system" })),
      ...user,
    ],
  };
}

/**
 * Adds and removes labels on whole threads. Labels are given by ID or by
 * name; trash, spam and Gmail's other bookkeeping labels are refused, so this
 * can sort mail but not delete it.
 */
export async function modifyGmailLabels(
  userId: string,
  input: { threadIds: string[]; add: string[]; remove: string[] },
  signal?: AbortSignal,
): Promise<GmailModifyLabelsOutput> {
  if (input.add.length === 0 && input.remove.length === 0) {
    throw new IntegrationError("Name at least one label to add or remove.", 400);
  }
  const labels = await fetchLabels(userId, signal);
  const resolve = (wanted: string): GmailApiLabel => {
    const name = wanted.trim();
    const label =
      labels.find((candidate) => candidate.id === name) ??
      labels.find(
        (candidate) => candidate.name?.toLowerCase() === name.toLowerCase(),
      ) ??
      (SORTING_LABELS.includes(name.toUpperCase())
        ? { id: name.toUpperCase(), type: "system" }
        : undefined);
    if (!label) {
      throw new IntegrationError(
        `Gmail has no label named "${name}". gmail_list_labels shows the ones that exist.`,
        400,
      );
    }
    if (label.type !== "user" && !SORTING_LABELS.includes(label.id)) {
      throw new IntegrationError(
        `The ${label.name ?? label.id} label cannot be changed. Deleting mail and marking it as spam are not available.`,
        400,
      );
    }
    return label;
  };
  const added = [...new Set(input.add)].map(resolve);
  const removed = [...new Set(input.remove)].map(resolve);
  const both = added.find((label) => removed.some((other) => other.id === label.id));
  if (both) {
    throw new IntegrationError(
      `${both.name ?? both.id} cannot be both added and removed.`,
      400,
    );
  }

  const threadIds = [...new Set(input.threadIds)];
  const body = {
    addLabelIds: added.map((label) => label.id),
    removeLabelIds: removed.map((label) => label.id),
  };
  for (let start = 0; start < threadIds.length; start += MODIFY_CONCURRENCY) {
    await Promise.all(
      threadIds.slice(start, start + MODIFY_CONCURRENCY).map((threadId) =>
        gmailRequest(userId, `/threads/${encodeURIComponent(threadId)}/modify`, {
          body,
          signal,
        }),
      ),
    );
  }
  const display = (label: GmailApiLabel) =>
    label.type === "user" ? (label.name ?? label.id) : label.id;
  return {
    account: mailbox(userId),
    threads: threadIds.length,
    added: added.map(display),
    removed: removed.map(display),
  };
}

export interface GmailDraftInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  body: string;
  /** Makes the draft a reply in that message's thread. */
  replyToMessageId?: string;
}

/** RFC 2047: header text outside ASCII travels as an encoded word. */
function encodeHeaderText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** "Name <a@b>" → "a@b". */
function addressOf(value: string): string {
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim();
}

/** An RFC 5322 message with a UTF-8 text body. Gmail supplies From and Date. */
export function buildDraftMessage(input: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeaderText(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (headers.some((line) => /[\r\n]/.test(line))) {
    throw new IntegrationError("Email headers cannot contain line breaks.", 400);
  }
  const body = Buffer.from(input.body, "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** Saves a draft in the user's mailbox. It is never sent from here. */
export async function createGmailDraft(
  userId: string,
  input: GmailDraftInput,
  signal?: AbortSignal,
): Promise<GmailDraftOutput> {
  let to = input.to;
  let subject = input.subject?.trim() ?? "";
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (input.replyToMessageId) {
    const original = await gmailRequest<GmailApiMessage>(
      userId,
      `/messages/${encodeURIComponent(input.replyToMessageId)}?${metadataQuery([
        "From",
        "Reply-To",
        "Subject",
        "Message-ID",
        "References",
      ])}`,
      { signal },
    );
    threadId = original.threadId;
    const messageId = header(original.payload, "Message-ID");
    if (messageId) {
      inReplyTo = messageId;
      references = [header(original.payload, "References"), messageId]
        .filter(Boolean)
        .join(" ");
    }
    if (to.length === 0) {
      const sender =
        header(original.payload, "Reply-To") || header(original.payload, "From");
      if (sender) to = [addressOf(sender)];
    }
    if (!subject) {
      const originalSubject = header(original.payload, "Subject");
      subject = /^re:/i.test(originalSubject)
        ? originalSubject
        : `Re: ${originalSubject}`;
    }
  }
  if (to.length === 0) {
    throw new IntegrationError("A draft needs at least one recipient.", 400);
  }
  if (!subject) {
    throw new IntegrationError("A new draft needs a subject.", 400);
  }

  const raw = Buffer.from(
    buildDraftMessage({
      to,
      cc: input.cc,
      bcc: input.bcc,
      subject,
      body: input.body,
      inReplyTo,
      references,
    }),
    "utf8",
  ).toString("base64url");
  const draft = await gmailRequest<{
    id: string;
    message?: { threadId?: string };
  }>(userId, "/drafts", {
    body: { message: { raw, ...(threadId ? { threadId } : {}) } },
    signal,
  });

  return {
    draftId: draft.id,
    threadId: draft.message?.threadId ?? threadId ?? null,
    account: mailbox(userId),
    to: to.join(", "),
    subject,
  };
}
