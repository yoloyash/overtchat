"use client";

import type { RefObject } from "react";
import { ChevronDown, ChevronUp, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHAT_FIND_MAX_QUERY_LENGTH } from "@/lib/chat/find";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ChatFindBar({
  inputRef,
  query,
  total,
  activeIndex,
  pending,
  counting,
  historyIncomplete,
  onQueryChange,
  onNext,
  onPrevious,
  onRetryHistory,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  total: number;
  activeIndex: number;
  /** The typed query has not been searched yet. */
  pending: boolean;
  /** Older history is still loading, so more matches may arrive. */
  counting: boolean;
  /** Some older history failed to load and is not searched. */
  historyIncomplete: boolean;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onRetryHistory: () => void;
  onClose: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  // "?" marks matches with none selected yet, e.g. ones that arrived in a
  // reply that finished after the search.
  const position = activeIndex >= 0 ? String(activeIndex + 1) : "?";
  let status = "";
  if (hasQuery) {
    if (counting) status = total ? `${position}/…` : "Searching…";
    else if (total === 0) status = "No results";
    else status = `${position}/${total}`;
  }
  const noResults = status === "No results";

  return (
    <div
      role="search"
      aria-label="Find in chat"
      aria-busy={pending || counting}
      className="absolute top-2 right-3 z-20 flex w-[min(24rem,calc(100%-1.5rem))] items-center gap-1 rounded-lg border bg-popover/95 py-1 pr-1 pl-2.5 text-popover-foreground shadow-md backdrop-blur"
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        maxLength={CHAT_FIND_MAX_QUERY_LENGTH}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          ) {
            return;
          }
          event.preventDefault();
          if (event.shiftKey) onPrevious();
          else onNext();
        }}
        placeholder="Find in chat"
        aria-label="Find in chat"
        spellCheck={false}
        autoComplete="off"
        className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <span
        className={cn(
          "flex min-w-10 shrink-0 justify-end text-xs tabular-nums",
          noResults ? "text-destructive" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {pending && hasQuery ? (
          <LoaderCircle
            className={cn("size-3.5", motionClasses.spinner)}
            aria-label="Searching"
          />
        ) : (
          status
        )}
      </span>
      {historyIncomplete && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title="Earlier messages could not be loaded, so they are not searched."
          onClick={onRetryHistory}
        >
          Retry
        </Button>
      )}
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
