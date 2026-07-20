export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export interface ToolApproval {
  id: string;
  approved?: boolean;
  reason?: string;
  isAutomatic?: boolean;
  signature?: string;
}

export interface ToolStatePart {
  state?: string;
  approval?: Partial<ToolApproval>;
}

export interface WebSearchResult {
  link: string;
  title: string;
  snippet: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  content: string;
  wordCount: number;
}

export type WebSearchPart = {
  type: "tool-web_search";
  toolCallId: string;
  state: ToolState;
  input?: { query?: string; limit?: number };
  output?: WebSearchResult[];
  errorText?: string;
  approval?: ToolApproval;
};

export type FetchUrlPart = {
  type: "tool-fetch_url";
  toolCallId: string;
  state: ToolState;
  input?: { url?: string };
  output?: FetchedPage;
  errorText?: string;
  approval?: ToolApproval;
};

/**
 * AI SDK 7 emits a terminal `output-denied` state after a rejected approval.
 * The preceding `approval-responded` state can briefly reach clients first,
 * so treat an explicit negative response as denied as well.
 */
export function isToolDenied(part: ToolStatePart): boolean {
  return (
    part.state === "output-denied" ||
    (part.state === "approval-responded" &&
      part.approval?.approved === false)
  );
}

export function toolDenialReason(part: ToolStatePart): string | undefined {
  if (!isToolDenied(part)) return undefined;
  const reason = part.approval?.reason?.trim();
  return reason || undefined;
}

export function isToolSettled(part: ToolStatePart): boolean {
  return (
    part.state === "output-available" ||
    part.state === "output-error" ||
    isToolDenied(part)
  );
}

export function cleanDomain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

/**
 * Title-cased second-level-domain of a URL — for citation pills and the
 * Sources footer. e.g. reddit.com → "Reddit", news.ycombinator.com →
 * "Ycombinator". Falls back to the raw domain on parse error.
 */
export function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

export function brandName(url: string): string {
  const domain = cleanDomain(url);
  const parts = domain.split(".");
  const sld = parts.length >= 2 ? parts[parts.length - 2] : domain;
  if (!sld) return domain;
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}
