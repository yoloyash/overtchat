"use client";

import { useEffect, useState, type RefObject } from "react";
import { Reply } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { normalizeQuoteText } from "@overtchat/shared";

const BUTTON_HEIGHT = 32;
const BUTTON_HALF_WIDTH = 44;
const GAP = 8;
const EDGE = 4;
// Touch screens raise their own selection menu where the button would sit.
const POINTER_QUERY = "(hover: hover) and (pointer: fine)";

type Position = { top: number; left: number };

/**
 * The selected part of the transcript. A selection can run past it: a
 * triple-click on the last paragraph ends in whatever follows the transcript.
 * That part is left out, and a selection of the whole page is not a quote.
 */
function transcriptSelection(
  scrollElement: HTMLElement,
): { range: Range; clamped: boolean } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startInside = scrollElement.contains(range.startContainer);
  const endInside = scrollElement.contains(range.endContainer);
  if (startInside && endInside) return { range, clamped: false };
  if (!startInside && !endInside) return null;
  const clamped = range.cloneRange();
  if (!startInside) clamped.setStart(scrollElement, 0);
  if (!endInside) clamped.setEnd(scrollElement, scrollElement.childNodes.length);
  return { range: clamped, clamped: true };
}

function measure(scrollElement: HTMLElement): Position | null {
  if (!window.matchMedia(POINTER_QUERY).matches) return null;
  const range = transcriptSelection(scrollElement)?.range;
  if (!range || !range.toString().trim()) return null;

  const rect = range.getBoundingClientRect();
  const box = scrollElement.getBoundingClientRect();
  if (rect.bottom <= box.top || rect.top >= box.bottom) return null;

  // Above the selection, below it when its start is scrolled out of view, and
  // pinned to the top when the selection fills the transcript.
  const above = rect.top - box.top - BUTTON_HEIGHT - GAP;
  const below = rect.bottom - box.top + GAP;
  const top =
    above >= EDGE
      ? above
      : below + BUTTON_HEIGHT <= box.height - EDGE
        ? below
        : EDGE;
  const center = rect.left + rect.width / 2 - box.left;
  const left = Math.min(
    Math.max(center, BUTTON_HALF_WIDTH + EDGE),
    box.width - BUTTON_HALF_WIDTH - EDGE,
  );
  return { top, left };
}

/** Takes the selected transcript text and clears the selection. */
function takeSelectedText(scrollElement: HTMLElement): string {
  const selection = window.getSelection();
  const selected = transcriptSelection(scrollElement);
  if (!selection || !selected) return "";
  if (selected.clamped) {
    // Only a selection serializes text the way it is laid out.
    selection.removeAllRanges();
    selection.addRange(selected.range);
  }
  const text = normalizeQuoteText(selection.toString());
  selection.removeAllRanges();
  return text;
}

/**
 * The "Reply" button over selected transcript text. It appears once a
 * selection settles, follows it while the transcript scrolls, and hands the
 * selected text to `onQuote`.
 */
export function QuoteSelectionButton({
  scrollRef,
  onQuote,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    let dragging = false;
    let frame: number | null = null;

    const update = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setPosition(dragging ? null : measure(scrollElement));
      });
    };
    const handlePointerDown = () => {
      dragging = true;
    };
    const handlePointerUp = () => {
      dragging = false;
      update();
    };

    scrollElement.addEventListener("pointerdown", handlePointerDown);
    scrollElement.addEventListener("scroll", update, { passive: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("resize", update);
    document.addEventListener("selectionchange", update);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      scrollElement.removeEventListener("pointerdown", handlePointerDown);
      scrollElement.removeEventListener("scroll", update);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("resize", update);
      document.removeEventListener("selectionchange", update);
    };
  }, [scrollRef]);

  if (!position) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="absolute z-10 -translate-x-1/2 rounded-full bg-background/95 shadow-md backdrop-blur"
      style={position}
      // Pressing the button must not clear the selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const scrollElement = scrollRef.current;
        const text = scrollElement ? takeSelectedText(scrollElement) : "";
        if (text) onQuote(text);
        setPosition(null);
      }}
    >
      <Reply /> {t("chat.messages.reply")}
    </Button>
  );
}
