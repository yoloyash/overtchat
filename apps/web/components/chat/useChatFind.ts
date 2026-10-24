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
  CHAT_FIND_MAX_QUERY_LENGTH,
  collectChatFindMatches,
  collectChatFindRanges,
  initialChatFindIndex,
  resolveChatFindIndex,
  stepChatFindIndex,
  type ChatFindMatch,
} from "@/lib/chat/find";

const HIGHLIGHT = "chat-find";
const ACTIVE_HIGHLIGHT = "chat-find-active";
// Keeps a revealed match clear of the find bar and the transcript edges.
const REVEAL_MARGIN = 64;
// Rows measured or rendered after a jump (diagrams, highlighted code) resize
// the list and can move the match again, so the match stays pinned in place
// until it has held still this long, or the reader scrolls.
const REVEAL_SETTLE_MS = 600;
const REVEAL_MAX_MS = 3_000;
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

type Selection = { query: string; messageId: string; occurrence: number };
type RenderedCount = { message: UIMessage; query: string; count: number };

function supportsHighlights() {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

function messageRow(scrollElement: HTMLElement, messageId: string) {
  return scrollElement.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
}

function firstVisibleMessageId(scrollElement: HTMLElement) {
  const top = scrollElement.getBoundingClientRect().top;
  for (const row of scrollElement.querySelectorAll<HTMLElement>(
    "[data-message-id]",
  )) {
    if (row.getBoundingClientRect().bottom > top) return row.dataset.messageId;
  }
  return undefined;
}

/** Selected transcript text that can seed the query, as in browser find. */
function selectedTranscriptText(scrollElement: HTMLElement) {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !scrollElement.contains(selection.anchorNode)
  ) {
    return null;
  }
  const text = selection.toString().trim();
  return text &&
    text.length <= CHAT_FIND_MAX_QUERY_LENGTH &&
    !/[\r\n]/.test(text)
    ? text
    : null;
}

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

/** Scrolls code blocks and tables sideways so the match is not clipped. */
function revealHorizontally(range: Range, row: HTMLElement) {
  for (
    let element = range.startContainer.parentElement;
    element && element !== row;
    element = element.parentElement
  ) {
    if (element.scrollWidth <= element.clientWidth) continue;
    const overflow = getComputedStyle(element).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const rect = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    if (rect.left < box.left + 16) element.scrollLeft += rect.left - box.left - 16;
    else if (rect.right > box.right - 16) {
      element.scrollLeft += rect.right - box.right + 16;
    }
  }
}

/** How far to scroll so the match sits in view, centered if it was outside. */
function verticalRevealDelta(range: Range, scrollElement: HTMLElement) {
  const rect = range.getBoundingClientRect();
  const box = scrollElement.getBoundingClientRect();
  const margin = Math.min(
    REVEAL_MARGIN,
    Math.max(0, (box.height - rect.height) / 2),
  );
  if (rect.top >= box.top + margin && rect.bottom <= box.bottom - margin) {
    return 0;
  }
  return rect.top + rect.height / 2 - (box.top + box.height / 2);
}

/**
 * In-chat find. ⌘F/Ctrl+F opens it and loads the rest of the history; matches
 * come from message text, corrected by the rendered text of each message once
 * it has been on screen. Only user actions (a new query, Enter, ⌘G) move the
 * view, and any scroll input by the reader stops that movement. The message
 * still streaming joins the results when it completes.
 */
export function useChatFind({
  messages,
  liveMessageId,
  historyComplete,
  scrollRef,
  jumpToIndex,
  onOpen,
}: {
  messages: UIMessage[];
  liveMessageId: string | undefined;
  historyComplete: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Scrolls the list to a message row, which may not be mounted yet. */
  jumpToIndex: (index: number) => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [navigation, setNavigation] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [renderedCounts, setRenderedCounts] = useState<
    ReadonlyMap<string, RenderedCount>
  >(() => new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const settledQueryRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 100);
    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = open ? debouncedQuery.trim() : "";
  const matches = useMemo(
    () =>
      collectChatFindMatches(messages, searchQuery, (message) => {
        if (message.id === liveMessageId) return 0;
        const rendered = renderedCounts.get(message.id);
        return rendered?.message === message && rendered.query === searchQuery
          ? rendered.count
          : undefined;
      }),
    [liveMessageId, messages, renderedCounts, searchQuery],
  );
  const activeIndex =
    selection?.query === searchQuery
      ? resolveChatFindIndex(matches, selection)
      : -1;
  const activeMatch: ChatFindMatch | undefined = matches[activeIndex];

  const select = useCallback(
    (match: ChatFindMatch | undefined) => {
      if (!match) return;
      setSelection({
        query: searchQuery,
        messageId: match.messageId,
        occurrence: match.occurrence,
      });
      setNavigation((current) => current + 1);
    },
    [searchQuery],
  );

  // A new query starts at the match nearest the reader. While older history
  // is still loading, its matches can still arrive, so wait for them.
  useEffect(() => {
    if (!searchQuery) {
      settledQueryRef.current = null;
      return;
    }
    if (settledQueryRef.current === searchQuery) return;
    const scrollElement = scrollRef.current;
    if (matches.length && scrollElement) {
      settledQueryRef.current = searchQuery;
      const visibleId = firstVisibleMessageId(scrollElement);
      const visibleIndex = messages.findIndex(({ id }) => id === visibleId);
      select(matches[initialChatFindIndex(matches, Math.max(0, visibleIndex))]);
    } else if (historyComplete) {
      settledQueryRef.current = searchQuery;
      setSelection(null);
    }
  }, [historyComplete, matches, messages, scrollRef, searchQuery, select]);

  const step = useCallback(
    (delta: number) => {
      select(matches[stepChatFindIndex(activeIndex, matches.length, delta)]);
    },
    [activeIndex, matches, select],
  );

  const openFind = useCallback(() => {
    const scrollElement = scrollRef.current;
    const seed = scrollElement && selectedTranscriptText(scrollElement);
    if (seed) {
      setQuery(seed);
      setDebouncedQuery(seed);
      settledQueryRef.current = null;
    }
    if (!open) {
      const focused = document.activeElement;
      returnFocusRef.current = focused instanceof HTMLElement ? focused : null;
      setOpen(true);
      onOpen?.();
    }
    setFocusRequest((current) => current + 1);
  }, [onOpen, open, scrollRef]);

  const close = useCallback(() => {
    setOpen(false);
    setSelection(null);
    settledQueryRef.current = null;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest, open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role=dialog]")) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey && !event.shiftKey && key === "f") {
        event.preventDefault();
        openFind();
      } else if (open && mod && !event.altKey && key === "g") {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      } else if (
        open &&
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        event.keyCode !== 229
      ) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, open, openFind, step]);

  const messagesRef = useRef(messages);
  const activeMatchRef = useRef(activeMatch);
  const renderedCountsRef = useRef(renderedCounts);
  const jumpToIndexRef = useRef(jumpToIndex);
  useLayoutEffect(() => {
    messagesRef.current = messages;
    activeMatchRef.current = activeMatch;
    renderedCountsRef.current = renderedCounts;
    jumpToIndexRef.current = jumpToIndex;
  });

  // Paint mounted matches, and record each mounted message's rendered count.
  // Rows are rescanned only when their own content changes.
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !searchQuery) return;
    const highlights = supportsHighlights();
    const cache = new Map<Element, Range[]>();
    const paint = () => {
      const active = activeMatchRef.current;
      const byId = new Map(messagesRef.current.map((message) => [message.id, message]));
      const all = highlights ? new Highlight() : null;
      const current = highlights ? new Highlight() : null;
      let counts: Map<string, RenderedCount> | null = null;
      for (const row of scrollElement.querySelectorAll<HTMLElement>(
        "[data-message-id]",
      )) {
        const messageId = row.dataset.messageId ?? "";
        const message = byId.get(messageId);
        if (!message || messageId === liveMessageId) continue;
        let ranges = cache.get(row);
        if (!ranges) {
          ranges = collectChatFindRanges(row, searchQuery);
          cache.set(row, ranges);
        }
        const known = renderedCountsRef.current.get(messageId);
        if (
          known?.message !== message ||
          known.query !== searchQuery ||
          known.count !== ranges.length
        ) {
          counts ??= new Map(renderedCountsRef.current);
          counts.set(messageId, {
            message,
            query: searchQuery,
            count: ranges.length,
          });
        }
        ranges.forEach((range, occurrence) => {
          const isActive =
            active?.messageId === messageId && active.occurrence === occurrence;
          (isActive ? current : all)?.add(range);
        });
      }
      for (const row of cache.keys()) if (!row.isConnected) cache.delete(row);
      if (counts) {
        renderedCountsRef.current = counts;
        setRenderedCounts(counts);
      }
      if (all && current) {
        CSS.highlights.set(HIGHLIGHT, all);
        CSS.highlights.set(ACTIVE_HIGHLIGHT, current);
      }
    };
    let frame: number | null = null;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        const row = target?.closest("[data-message-id]");
        if (row) cache.delete(row);
      }
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
      if (highlights) {
        CSS.highlights.delete(HIGHLIGHT);
        CSS.highlights.delete(ACTIVE_HIGHLIGHT);
      }
    };
  }, [
    activeMatch?.messageId,
    activeMatch?.occurrence,
    liveMessageId,
    scrollRef,
    searchQuery,
  ]);

  // Bring the selected match into view: jump the list to its row until the row
  // renders, then center the exact text. Reader scroll input cancels.
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!navigation || !scrollElement) return;
    let frame = 0;
    let cancelled = false;
    const startedAt = performance.now();
    let movedAt = startedAt;
    // Where the match sits once in view; later layout shifts are undone.
    let pinnedTop: number | null = null;
    const cancel = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key) && !isTextEntry(event.target)) cancel();
    };
    scrollElement.addEventListener("wheel", cancel, { passive: true });
    scrollElement.addEventListener("touchmove", cancel, { passive: true });
    scrollElement.addEventListener("pointerdown", cancel);
    window.addEventListener("keydown", onKey);
    const reveal = () => {
      const match = activeMatchRef.current;
      if (cancelled || !match) return;
      const now = performance.now();
      const row = messageRow(scrollElement, match.messageId);
      const range =
        row && collectChatFindRanges(row, searchQuery)[match.occurrence];
      if (row && range) {
        revealHorizontally(range, row);
        const delta =
          pinnedTop === null
            ? verticalRevealDelta(range, scrollElement)
            : range.getBoundingClientRect().top - pinnedTop;
        const before = scrollElement.scrollTop;
        if (Math.abs(delta) >= 1) scrollElement.scrollTop += delta;
        const moved = Math.abs(scrollElement.scrollTop - before) >= 1;
        if (moved) movedAt = now;
        // At either end of the transcript the match may sit as close as it
        // can get, so a scroll that cannot move also pins it.
        if (pinnedTop === null && !moved) {
          pinnedTop = range.getBoundingClientRect().top;
        }
        if (pinnedTop !== null && now - movedAt >= REVEAL_SETTLE_MS) return;
      } else {
        // Row offsets are estimates until rows are measured, so keep jumping
        // until the row, and with it the match, is rendered.
        const index = messagesRef.current.findIndex(
          ({ id }) => id === match.messageId,
        );
        if (index === -1) return;
        jumpToIndexRef.current(index);
        movedAt = now;
      }
      if (now - startedAt < REVEAL_MAX_MS) {
        frame = requestAnimationFrame(reveal);
      }
    };
    reveal();
    return () => {
      cancel();
      scrollElement.removeEventListener("wheel", cancel);
      scrollElement.removeEventListener("touchmove", cancel);
      scrollElement.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", onKey);
    };
    // Only a navigation scrolls; content updates must not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

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
