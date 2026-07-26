"use client";

import type { UIMessage } from "ai";
import {
  cleanDomain,
  faviconUrl,
  type WebSearchResult,
} from "@/lib/web-client";
import {
  buildWebCitationIndex,
  type CitationRefType,
  type ResolvedWebCitation,
} from "@overtchat/shared";

export type SourceLookup = (
  turn: number,
  refType: CitationRefType,
  index: number,
) => ResolvedWebCitation | undefined;

export function buildSourceLookup(message: UIMessage): SourceLookup {
  return buildWebCitationIndex(message.parts).resolve;
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
  const resolved = props.lookup(turn, refType, index);
  if (!resolved) return null;
  return <CitationPill source={resolved.source} n={resolved.number} />;
}

export function CompositeCitation(props: {
  citations?: string;
  lookup: SourceLookup;
}) {
  let parsed: Array<{ turn: number; refType: CitationRefType; index: number }> =
    [];
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

export function HighlightedText({ children }: { children?: React.ReactNode }) {
  return <span className="rounded bg-amber-300/20 px-0.5">{children}</span>;
}
