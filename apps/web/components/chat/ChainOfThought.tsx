"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  ChevronDown,
  CircleAlert,
  Globe,
  Loader2,
  Wrench,
  type LucideIcon,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import { cleanDomain, faviconUrl } from "@/lib/web-client";
import {
  type FetchedImage,
  type FetchUrlPart,
  isToolSettled,
  webSearchProviderLabel,
  webSearchResults,
  type WebSearchPart,
  type WebSearchResult,
} from "@overtchat/shared";
import { parseMcpToolName } from "@overtchat/shared";
import type { DynamicToolUIPart } from "ai";
import { ThinkingContent } from "./ThinkingContent";

type ReasoningPart = { type: "reasoning"; text: string; state?: string };
export type ActivityPart =
  | WebSearchPart
  | FetchUrlPart
  | DynamicToolUIPart
  | ReasoningPart;

function isWebSearch(p: ActivityPart): p is WebSearchPart {
  return p.type === "tool-web_search";
}
function isFetchUrl(p: ActivityPart): p is FetchUrlPart {
  return p.type === "tool-fetch_url";
}
function isReasoning(p: ActivityPart): p is ReasoningPart {
  return p.type === "reasoning";
}
function isMcpTool(p: ActivityPart): p is DynamicToolUIPart {
  return p.type === "dynamic-tool" && parseMcpToolName(p.toolName) !== null;
}

/**
 * One run of model "work" — interleaved reasoning + web tool calls — rendered
 * as a chain-of-thought timeline: a single live status line up top, then a
 * left-rail timeline where each part is its own typed step node, in order.
 * Adding a new activity kind (e.g. code execution) is one new step icon +
 * renderer; nothing else moves.
 */
export function ChainOfThought({
  parts,
  active,
}: {
  parts: ActivityPart[];
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (active) {
      if (startedAtRef.current == null) startedAtRef.current = Date.now();
      settledRef.current = false;
      const tick = () => {
        if (startedAtRef.current != null) {
          setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      };
      tick();
      const id = window.setInterval(tick, 1000);
      return () => window.clearInterval(id);
    }
    if (startedAtRef.current != null && !settledRef.current) {
      settledRef.current = true;
      setDuration(
        Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
    }
  }, [active]);

  const hasTools = parts.some(
    (p) => isWebSearch(p) || isFetchUrl(p) || isMcpTool(p),
  );
  const lastTool = [...parts]
    .reverse()
    .find(
      (part) => isWebSearch(part) || isFetchUrl(part) || isMcpTool(part),
    );
  const lastToolFailed = lastTool?.state === "output-error";
  const last = parts[parts.length - 1];

  const StatusIcon = active
    ? Loader2
    : lastToolFailed
      ? CircleAlert
      : hasTools
        ? Globe
        : Brain;
  const label = active ? activeLabel(last) : settledLabel(parts, duration);

  return (
    <div className="text-xs">
      {/* Live status line — the only thing visible when collapsed. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group/cot flex w-full items-center gap-2 py-1 text-left text-muted-foreground motion-colors hover:text-foreground"
      >
        <StatusIcon
          className={cn("size-4 shrink-0", active && motionClasses.spinner)}
        />
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            active ? `${motionClasses.shimmer} text-foreground` : "text-foreground",
          )}
        >
          {label}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 motion-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Timeline — typed step nodes on a left rail, in original order. */}
      <div
        className={cn(
          "grid",
          motionClasses.collapse,
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="pt-1">
            {parts.map((part, i) => (
              <Step key={i} part={part} isLast={i === parts.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A single timeline node: left rail (icon + connector) + the step's content. */
function Step({ part, isLast }: { part: ActivityPart; isLast: boolean }) {
  const icon =
    (isWebSearch(part) || isFetchUrl(part) || isMcpTool(part)) &&
    part.state === "output-error"
      ? CircleAlert
      : isWebSearch(part)
        ? Search
        : isFetchUrl(part)
          ? Globe
          : isMcpTool(part)
            ? Wrench
          : Brain;

  return (
    <div className="flex gap-2.5">
      <Rail icon={icon} isLast={isLast} />
      <div className="min-w-0 flex-1 pb-3">
        {isWebSearch(part) ? (
          <SearchStep part={part} />
        ) : isFetchUrl(part) ? (
          <FetchStep part={part} />
        ) : isMcpTool(part) ? (
          <McpStep part={part} />
        ) : isReasoning(part) ? (
          <ThinkingContent content={part.text} />
        ) : null}
      </div>
    </div>
  );
}

function McpStep({ part }: { part: DynamicToolUIPart }) {
  const parsed = parseMcpToolName(part.toolName);
  const title = part.title ?? parsed?.toolName ?? part.toolName;
  const server = parsed?.serverName ?? "MCP";
  const running = !["output-available", "output-error", "output-denied"].includes(
    part.state,
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {server} · {title}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {running ? "Running" : part.state === "output-error" ? "Failed" : "Done"}
        </span>
      </div>
      {part.state === "output-error" ? (
        <p className="text-destructive">{part.errorText}</p>
      ) : (
        <ToolValue label="Input" value={part.input} />
      )}
      {part.state === "output-available" && (
        <ToolValue label="Output" value={part.output} />
      )}
    </div>
  );
}

function ToolValue({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  const text = formatToolValue(value);
  if (!text) return null;
  return (
    <div className="rounded-lg border bg-background/40 px-2.5 py-2">
      <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-foreground">
        {text}
      </pre>
    </div>
  );
}

function formatToolValue(value: unknown): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n…` : text;
}

/** Left gutter: the step's icon with a connecting line down to the next node. */
function Rail({ icon: Icon, isLast }: { icon: LucideIcon; isLast: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3" />
      </div>
      {!isLast && <div className="mt-1 w-px flex-1 bg-border" />}
    </div>
  );
}

function SearchStep({ part }: { part: WebSearchPart }) {
  const query = part.input?.query?.trim();
  const results = webSearchResults(part.output);
  const provider = webSearchProviderLabel(part.output);
  const hasAnswer =
    part.output !== undefined &&
    !Array.isArray(part.output) &&
    Boolean(part.output.answer);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {query || "Searching…"}
        </span>
        {part.state === "output-available" && (
          <span className="shrink-0 text-muted-foreground">
            {results.length > 0
              ? `${results.length} ${results.length === 1 ? "result" : "results"}`
              : hasAnswer
                ? "answer"
                : "no results"}
            {provider ? ` · ${provider}` : ""}
          </span>
        )}
      </div>

      {part.state === "output-error" ? (
        <p className="text-destructive">{part.errorText}</p>
      ) : results.length === 0 ? null : (
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border bg-background/40">
          {results.map((r, i) => (
            <ResultRow key={i} result={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultRow({ result }: { result: WebSearchResult }) {
  const domain = cleanDomain(result.link);
  return (
    <li>
      <a
        href={result.link}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2.5 px-2.5 py-2 motion-colors hover:bg-accent/60"
      >
        <Favicon domain={domain} className="size-4 shrink-0 rounded-sm" />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {result.title}
        </span>
        <span className="shrink-0 text-muted-foreground">{domain}</span>
      </a>
    </li>
  );
}

function FetchStep({ part }: { part: FetchUrlPart }) {
  const url = part.input?.url;
  const domain = url ? cleanDomain(url) : "";
  const running = !isToolSettled(part);
  const page = part.output;

  if (part.state === "output-error") {
    return (
      <div className="space-y-1.5">
        <div className="font-medium text-foreground">
          Read {domain || "page"}
        </div>
        <p className="text-destructive">{part.errorText}</p>
      </div>
    );
  }

  if (isFetchedImage(page)) {
    return (
      <a
        href={page.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2.5 rounded-lg border bg-background/40 p-2 motion-colors hover:bg-accent/60"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={page.uploadUrl}
          alt=""
          loading="lazy"
          className="size-12 shrink-0 rounded-md bg-muted object-cover"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {page.filename}
          </span>
          <span className="block truncate text-muted-foreground">
            {cleanDomain(page.url)}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">Image</span>
      </a>
    );
  }

  return (
    <a
      href={page?.url ?? url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg border bg-background/40 px-2.5 py-2 motion-colors hover:bg-accent/60"
    >
      {running ? (
        <Loader2 className={cn("size-4 shrink-0 text-muted-foreground", motionClasses.spinner)} />
      ) : (
        <Favicon domain={domain} className="size-4 shrink-0 rounded-sm" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">
        {page?.title ?? (running ? "Reading…" : domain)}
      </span>
      {page && (
        <span className="shrink-0 text-muted-foreground">
          {page.wordCount.toLocaleString()} words
        </span>
      )}
    </a>
  );
}

function isFetchedImage(value: unknown): value is FetchedImage {
  return (
    Boolean(value && typeof value === "object") &&
    (value as Partial<FetchedImage>).kind === "image"
  );
}

/**
 * A domain favicon with a fallback chain: Google's favicon service →
 * DuckDuckGo → a globe glyph. Both services 404 on unknown domains, so the
 * client-side fallback is required, not optional.
 */
function Favicon({
  domain,
  className,
}: {
  domain: string;
  className?: string;
}) {
  const [idx, setIdx] = useState(0);
  const sources = useMemo(
    () => [
      faviconUrl(domain, 64),
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    ],
    [domain],
  );

  if (idx >= sources.length) {
    return (
      <Globe
        className={cn("bg-background p-0.5 text-muted-foreground", className)}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[idx]}
      alt=""
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
      className={cn("bg-background object-contain", className)}
    />
  );
}

function activeLabel(last: ActivityPart | undefined): string {
  if (!last) return "Working…";
  if (last.type === "tool-web_search") {
    const query = last.input?.query?.trim();
    return query ? `Searching "${query}"` : "Searching the web…";
  }
  if (last.type === "tool-fetch_url") {
    const url = last.input?.url;
    return url ? `Reading ${cleanDomain(url)}` : "Reading page…";
  }
  if (isMcpTool(last)) {
    const parsed = parseMcpToolName(last.toolName);
    return parsed
      ? `Running ${parsed.serverName} · ${parsed.toolName}`
      : "Running MCP tool…";
  }
  return "Thinking";
}

function settledLabel(parts: ActivityPart[], duration: number): string {
  const lastTool = [...parts]
    .reverse()
    .find(
      (part) => isWebSearch(part) || isFetchUrl(part) || isMcpTool(part),
    );
  if (lastTool?.type === "tool-web_search") {
    if (lastTool.state === "output-error") return "Web search failed";
    if (lastTool.state === "output-available") return "Searched the web";
    return "Web search did not complete";
  }
  if (lastTool?.type === "tool-fetch_url") {
    if (lastTool.state === "output-error") return "Page fetch failed";
    if (lastTool.state === "output-available") {
      return isFetchedImage(lastTool.output) ? "Viewed image" : "Read page";
    }
    return "Page fetch did not complete";
  }
  if (lastTool && isMcpTool(lastTool)) {
    const parsed = parseMcpToolName(lastTool.toolName);
    const label = parsed
      ? `${parsed.serverName} · ${parsed.toolName}`
      : "MCP tool";
    if (lastTool.state === "output-error") return `${label} failed`;
    if (lastTool.state === "output-available") return `Used ${label}`;
    return `${label} did not complete`;
  }
  return duration > 0 ? `Thought for ${duration}s` : "Thoughts";
}
