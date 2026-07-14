"use client";

import type { UIMessage } from "ai";
import { cleanDomain, faviconUrl, type WebSearchResult } from "@/lib/web-client";
import type { WebSearchPart } from "@overtchat/shared";
import type { CitationRefType } from "@/lib/citations";

const SOURCE_REF_TYPES = new Set<CitationRefType>(["search", "news", "ref"]);

export type SourceLookup = (
  turn: number,
  refType: CitationRefType,
  index: number,
) => WebSearchResult | undefined;

export function buildSourceLookup(message: UIMessage): SourceLookup {
  const flat: WebSearchResult[] = [];
  for (const part of message.parts) {
    const sp = part as unknown as WebSearchPart;
    if (sp.type === "tool-web_search" && Array.isArray(sp.output)) {
      flat.push(...sp.output);
    }
  }
  return (_turn, refType, index) => {
    if (!SOURCE_REF_TYPES.has(refType)) return undefined;
    return flat[index];
  };
}

function CitationPill({ source, n }: { source: WebSearchResult; n: number }) {
  const domain = cleanDomain(source.link);
  return (
    <a
      href={source.link}
      target="_blank"
      rel="noopener noreferrer"
      title={`${source.title} — ${domain}`}
      className="ml-0.5 inline-flex h-[18px] items-center gap-1 rounded-full border bg-muted px-1.5 align-baseline text-[10px] font-medium leading-none text-muted-foreground no-underline motion-colors hover:bg-accent hover:text-foreground"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={faviconUrl(domain)}
        alt=""
        loading="lazy"
        className="size-3 rounded-full"
      />
      <span>{n}</span>
    </a>
  );
}

export function Citation(props: {
  turn?: string | number;
  reftype?: CitationRefType;
  index?: string | number;
  lookup: SourceLookup;
}) {
  const turn = Number(props.turn ?? 0);
  const refType = (props.reftype ?? "search") as CitationRefType;
  const index = Number(props.index ?? 0);
  const source = props.lookup(turn, refType, index);
  if (!source) return null;
  return <CitationPill source={source} n={index + 1} />;
}

export function CompositeCitation(props: {
  citations?: string;
  lookup: SourceLookup;
}) {
  let parsed: Array<{ turn: number; refType: CitationRefType; index: number }> = [];
  try {
    parsed = JSON.parse(props.citations ?? "[]");
  } catch {
    return null;
  }
  return (
    <>
      {parsed.map((c, i) => (
        <Citation
          key={i}
          turn={c.turn}
          reftype={c.refType}
          index={c.index}
          lookup={props.lookup}
        />
      ))}
    </>
  );
}

export function HighlightedText({
  children,
}: {
  children?: React.ReactNode;
}) {
  return <span className="rounded bg-amber-300/20 px-0.5">{children}</span>;
}
