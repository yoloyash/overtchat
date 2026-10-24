"use client";

import type { RefObject } from "react";
import { ChevronDown, ChevronUp, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motionClasses } from "@/lib/motion";

export function ChatFindBar({
  inputRef,
  query,
  total,
  activeIndex,
  pending,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  total: number;
  activeIndex: number;
  pending: boolean;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const status = !hasQuery
    ? ""
    : total === 0
      ? "No results"
      : `${activeIndex + 1}/${total}`;

  return (
    <div
      role="search"
      className="absolute top-2 right-3 z-20 flex w-[min(22rem,calc(100%-1.5rem))] items-center gap-1 rounded-lg border bg-popover/95 py-1 pr-1 pl-2.5 text-popover-foreground shadow-md backdrop-blur"
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in chat"
        aria-label="Find in chat"
        spellCheck={false}
        autoComplete="off"
        className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <span
        className="flex min-w-10 shrink-0 justify-end text-xs tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {pending && hasQuery ? (
          <LoaderCircle
            className={`size-3.5 ${motionClasses.spinner}`}
            aria-label="Searching"
          />
        ) : (
          status
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={total === 0}
        onClick={onPrevious}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={total === 0}
        onClick={onNext}
      >
        <ChevronDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Close find"
        title="Close (Esc)"
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}
