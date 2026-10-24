"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { UIMessage } from "ai";
import {
  collectChatFindMatches,
  collectChatFindRanges,
  initialChatFindIndex,
  stepChatFindIndex,
  type ChatFindMatch,
} from "@/lib/chat/find";

const HIGHLIGHT = "chat-find";
const ACTIVE_HIGHLIGHT = "chat-find-active";
// Keeps a revealed match clear of the find bar and the transcript edges.
const REVEAL_MARGIN = 64;
const REVEAL_ATTEMPTS = 90;
// Rows measured after a jump resize the list and can move the match again, so
// the match must stay in view for a few frames before revealing stops.
const REVEAL_STABLE_FRAMES = 5;

type ActiveMatch = { query: string; messageId: string; occurrence: number };

function supportsHighlights() {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

function firstVisibleMessageIndex(scrollElement: HTMLElement): number {
  const top = scrollElement.getBoundingClientRect().top;
  for (const row of scrollElement.querySelectorAll<HTMLElement>(
    "[data-transcript-item]",
  )) {
    if (row.getBoundingClientRect().bottom > top) {
      return Number(row.dataset.index ?? 0);
    }
  }
  return 0;
}

function messageRow(scrollElement: HTMLElement, messageId: string) {
  return scrollElement.querySelector(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
}

// Rendered text can hold fewer occurrences than the source predicted, e.g.
// around math; the last one stands in for any that are missing.
function rangeFor(ranges: Range[], occurrence: number): Range | undefined {
  return ranges[Math.min(occurrence, ranges.length - 1)];
}

/**
 * In-chat find: ⌘F/Ctrl+F opens it, matches come from the loaded messages, and
 * the virtualized transcript scrolls each selected match into view while CSS
 * custom highlights paint the matches that are mounted.
 */
export function useChatFind({
  messages,
  scrollRef,
  scrollToIndex,
  onOpen,
}: {
  messages: UIMessage[];
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollToIndex: (index: number) => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [active, setActive] = useState<ActiveMatch | null>(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 100);
    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = open ? debouncedQuery.trim() : "";
  const matches = useMemo(
    () => collectChatFindMatches(messages, searchQuery),
    [messages, searchQuery],
  );
  const activeIndex =
    active?.query === searchQuery
      ? matches.findIndex(
          (match) =>
            match.messageId === active.messageId &&
            match.occurrence === active.occurrence,
        )
      : -1;
  const activeMatch: ChatFindMatch | undefined = matches[activeIndex];

  const select = useCallback(
    (match: ChatFindMatch | undefined) => {
      setActive(
        match
          ? {
              query: searchQuery,
              messageId: match.messageId,
              occurrence: match.occurrence,
            }
          : null,
      );
      if (match) setRevealRequest((request) => request + 1);
    },
    [searchQuery],
  );

  // A new query, or the first matches to arrive for it, selects the match
  // nearest the reader rather than the top of the chat.
  const needsInitialMatch = active?.query !== searchQuery;
  useEffect(() => {
    if (!needsInitialMatch) return;
    const scrollElement = scrollRef.current;
    if (!searchQuery || !matches.length || !scrollElement) {
      setActive(null);
      return;
    }
    select(
      matches[
        initialChatFindIndex(matches, firstVisibleMessageIndex(scrollElement))
      ],
    );
  }, [matches, needsInitialMatch, scrollRef, searchQuery, select]);

  const step = useCallback(
    (delta: number) => {
      select(matches[stepChatFindIndex(activeIndex, matches.length, delta)]);
    },
    [activeIndex, matches, select],
  );

  const openFind = useCallback(() => {
    if (!open) {
      const focused = document.activeElement;
      returnFocusRef.current = focused instanceof HTMLElement ? focused : null;
      setOpen(true);
      onOpen?.();
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [onOpen, open]);

  const close = useCallback(() => {
    setOpen(false);
    setActive(null);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role=dialog]")) return;
      const key = event.key.toLowerCase();
      if (key === "f" && !event.shiftKey) {
        event.preventDefault();
        openFind();
      } else if (key === "g" && open) {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openFind, step]);

  const activeMatchRef = useRef(activeMatch);
  useLayoutEffect(() => {
    activeMatchRef.current = activeMatch;
  });

  // Paint every mounted match, and repaint as rows mount or text streams in.
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !searchQuery || !supportsHighlights()) return;
    const paint = () => {
      const current = activeMatchRef.current;
      const all = new Highlight();
      const selected = new Highlight();
      for (const row of scrollElement.querySelectorAll<HTMLElement>(
        "[data-message-id]",
      )) {
        const ranges = collectChatFindRanges(row, searchQuery);
        const activeRange =
          current && row.dataset.messageId === current.messageId
            ? rangeFor(ranges, current.occurrence)
            : undefined;
        for (const range of ranges) {
          (range === activeRange ? selected : all).add(range);
        }
      }
      CSS.highlights.set(HIGHLIGHT, all);
      CSS.highlights.set(ACTIVE_HIGHLIGHT, selected);
    };
    let frame: number | null = null;
    const observer = new MutationObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        paint();
      });
    });
    observer.observe(scrollElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    paint();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      CSS.highlights.delete(HIGHLIGHT);
      CSS.highlights.delete(ACTIVE_HIGHLIGHT);
    };
  }, [activeMatch?.messageId, activeMatch?.occurrence, scrollRef, searchQuery]);

  // Bring the selected match into view. Its row may not be mounted yet, so
  // jump the virtualizer to it, then center the exact text once it renders.
  const scrollToIndexRef = useRef(scrollToIndex);
  useLayoutEffect(() => {
    scrollToIndexRef.current = scrollToIndex;
  });
  useEffect(() => {
    const match = activeMatchRef.current;
    const scrollElement = scrollRef.current;
    if (!revealRequest || !match || !scrollElement) return;
    let frame = 0;
    let attempts = 0;
    let stableFrames = 0;
    let jumped = false;
    const reveal = () => {
      const row = messageRow(scrollElement, match.messageId);
      const range =
        row &&
        rangeFor(collectChatFindRanges(row, searchQuery), match.occurrence);
      if (range) {
        const rect = range.getBoundingClientRect();
        const box = scrollElement.getBoundingClientRect();
        if (
          rect.top >= box.top + REVEAL_MARGIN &&
          rect.bottom <= box.bottom - REVEAL_MARGIN
        ) {
          stableFrames += 1;
          if (stableFrames >= REVEAL_STABLE_FRAMES) return;
        } else {
          stableFrames = 0;
          scrollElement.scrollTop +=
            rect.top + rect.height / 2 - (box.top + box.height / 2);
        }
      } else if (!jumped) {
        jumped = true;
        scrollToIndexRef.current(match.messageIndex);
      }
      attempts += 1;
      if (attempts < REVEAL_ATTEMPTS) frame = requestAnimationFrame(reveal);
    };
    reveal();
    return () => cancelAnimationFrame(frame);
    // Only an explicit selection scrolls; streaming must not steal the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest]);

  return {
    open,
    query,
    setQuery,
    inputRef,
    total: matches.length,
    activeIndex,
    pending: open && query.trim() !== searchQuery,
    next: () => step(1),
    previous: () => step(-1),
    openFind,
    close,
  };
}
