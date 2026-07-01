"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  ChevronDown,
  Globe,
  Loader2,
  type LucideIcon,
  Search,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cleanDomain, faviconUrl } from "@/lib/web-client";
import type {
  FetchUrlPart,
  GenericToolPart,
  WebSearchPart,
  WebSearchResult,
} from "@overtchat/shared";
import { ThinkingContent } from "./ThinkingContent";

type ReasoningPart = { type: "reasoning"; text: string; state?: string };
export type ActivityPart =
  | WebSearchPart
  | FetchUrlPart
  | GenericToolPart
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
function isGenericTool(p: ActivityPart): p is GenericToolPart {
  return (
    !isWebSearch(p) &&
    !isFetchUrl(p) &&
    (p.type === "dynamic-tool" || p.type.startsWith("tool-"))
  );
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

  const hasWebTools = parts.some((p) => isWebSearch(p) || isFetchUrl(p));
  const hasTools = hasWebTools || parts.some(isGenericTool);
  const last = parts[parts.length - 1];

  const StatusIcon = active ? Loader2 : hasWebTools ? Globe : hasTools ? Wrench : Brain;
  const label = active
    ? activeLabel(last)
    : settledLabel(hasWebTools, hasTools, duration);

  return (
    <div className="text-xs">
      {/* Live status line — the only thing visible when collapsed. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group/cot flex w-full items-center gap-2 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
      >
        <StatusIcon
          className={cn("size-4 shrink-0", active && "animate-spin")}
        />
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            active ? "animate-text-shimmer text-foreground" : "text-foreground",
          )}
        >
          {label}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Timeline — typed step nodes on a left rail, in original order. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
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
  const icon = isWebSearch(part)
    ? Search
    : isFetchUrl(part)
      ? Globe
      : isGenericTool(part)
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
        ) : isGenericTool(part) ? (
          <GenericToolStep part={part} />
        ) : isReasoning(part) ? (
          <ThinkingContent content={part.text} />
        ) : null}
      </div>
    </div>
  );
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
  const results = part.output ?? [];
  const running =
    part.state !== "output-available" && part.state !== "output-error";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {query || "Searching…"}
        </span>
        {part.state === "output-available" && (
          <span className="shrink-0 text-muted-foreground">
            {results.length} {results.length === 1 ? "result" : "results"}
          </span>
        )}
      </div>

      {part.state === "output-error" ? (
        <p className="text-destructive">{part.errorText}</p>
      ) : running && results.length === 0 ? null : (
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
        className="flex items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-accent/60"
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
  const running =
    part.state !== "output-available" && part.state !== "output-error";
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

  return (
    <a
      href={page?.url ?? url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg border bg-background/40 px-2.5 py-2 transition-colors hover:bg-accent/60"
    >
      {running ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
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

function GenericToolStep({ part }: { part: GenericToolPart }) {
  const name = toolDisplayName(part);
  const running =
    part.state !== "output-available" &&
    part.state !== "output-error" &&
    part.state !== "output-denied";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-foreground">
          {running ? `Calling ${name}` : name}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {toolStateLabel(part.state)}
        </span>
      </div>
      {part.state === "output-error" ? (
        <p className="text-destructive">{part.errorText}</p>
      ) : part.state === "output-denied" ? (
        <p className="text-muted-foreground">Tool call denied.</p>
      ) : (
        <div className="space-y-1.5">
          {part.input !== undefined && (
            <JsonBlock label="Input" value={part.input} />
          )}
          {part.state === "output-available" && part.output !== undefined && (
            <JsonBlock label="Output" value={part.output} />
          )}
        </div>
      )}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-lg border bg-background/40 px-2.5 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {label}
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
        {formatUnknown(value)}
      </pre>
    </details>
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
  if (isWebSearch(last)) {
    const query = last.input?.query?.trim();
    return query ? `Searching "${query}"` : "Searching the web…";
  }
  if (isFetchUrl(last)) {
    const url = last.input?.url;
    return url ? `Reading ${cleanDomain(url)}` : "Reading page…";
  }
  if (last.type === "dynamic-tool" || last.type.startsWith("tool-")) {
    return `Calling ${toolDisplayName(last as GenericToolPart)}`;
  }
  return "Thinking";
}

function settledLabel(
  hasWebTools: boolean,
  hasTools: boolean,
  duration: number,
): string {
  if (hasWebTools) return "Searched the web";
  if (hasTools) return "Used tools";
  return duration > 0 ? `Thought for ${duration}s` : "Thoughts";
}

function toolDisplayName(part: GenericToolPart): string {
  const metadata = part.toolMetadata ?? {};
  const serverName =
    typeof metadata.serverName === "string" ? metadata.serverName : "";
  const displayName =
    typeof metadata.displayName === "string" ? metadata.displayName : "";
  const toolName =
    typeof metadata.toolName === "string"
      ? metadata.toolName
      : part.toolName || part.type.replace(/^tool-/, "");
  if (serverName && (displayName || toolName)) {
    return `${serverName}: ${displayName || toolName}`;
  }
  return displayName || toolName || "tool";
}

function toolStateLabel(state: GenericToolPart["state"]): string {
  switch (state) {
    case "input-streaming":
      return "Preparing";
    case "input-available":
      return "Running";
    case "approval-requested":
      return "Approval requested";
    case "approval-responded":
      return "Approved";
    case "output-available":
      return "Done";
    case "output-error":
      return "Error";
    case "output-denied":
      return "Denied";
    default:
      return "Working";
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return truncate(value);
  try {
    return truncate(JSON.stringify(value, null, 2));
  } catch {
    return String(value);
  }
}

function truncate(value: string): string {
  const max = 4_000;
  return value.length > max ? `${value.slice(0, max)}\n...` : value;
}
