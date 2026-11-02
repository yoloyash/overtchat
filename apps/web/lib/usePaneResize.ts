"use client";

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLocalStorage } from "./useLocalStorage";

/**
 * The size of a pane resized from a separator on its left or top edge, by
 * dragging or with the arrow keys, saved on this device. `minSize` and
 * `maxSize` are the limits that fit right now; a saved size outside them is
 * shown clamped and kept for when there is room again.
 */
export function usePaneResize({
  storageKey,
  defaultSize,
  minSize,
  maxSize,
  edge,
}: {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  edge: "left" | "top";
}) {
  const [stored, setStored] = useLocalStorage<unknown>(storageKey, null);
  const [dragSize, setDragSize] = useState<number | null>(null);
  const start = useRef<{ pointer: number; size: number } | null>(null);
  const maximum = Math.max(minSize, maxSize);
  const clamp = (value: number) => Math.min(maximum, Math.max(minSize, value));
  const preferred =
    typeof stored === "number" && Number.isFinite(stored) ? stored : defaultSize;
  const size = dragSize ?? clamp(preferred);
  const horizontal = edge === "left";
  const pointerOf = (event: ReactPointerEvent) =>
    horizontal ? event.clientX : event.clientY;

  function sizeFromPointer(pointer: number): number {
    // The separator sits on the pane's leading edge, so moving away from the
    // pane grows it.
    return start.current
      ? clamp(start.current.size + start.current.pointer - pointer)
      : size;
  }

  function release(event: ReactPointerEvent<HTMLDivElement>) {
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragSize(null);
  }

  return {
    size,
    resizing: dragSize !== null,
    separatorProps: {
      role: "separator",
      "aria-orientation": horizontal ? "vertical" : "horizontal",
      "aria-valuemin": minSize,
      "aria-valuemax": maximum,
      "aria-valuenow": Math.round(size),
      onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        event.preventDefault();
        start.current = { pointer: pointerOf(event), size };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragSize(size);
      },
      onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
        if (!start.current) return;
        event.preventDefault();
        setDragSize(sizeFromPointer(pointerOf(event)));
      },
      onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
        if (!start.current) return;
        const next = sizeFromPointer(pointerOf(event));
        release(event);
        setStored(next);
      },
      onPointerCancel: release,
      onDoubleClick() {
        setStored(null);
      },
      onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        const step = event.shiftKey ? 64 : 24;
        let next: number | null = null;
        if (event.key === (horizontal ? "ArrowLeft" : "ArrowUp")) next = size + step;
        if (event.key === (horizontal ? "ArrowRight" : "ArrowDown")) next = size - step;
        if (event.key === "Home") next = minSize;
        if (event.key === "End") next = maximum;
        if (next === null) return;
        event.preventDefault();
        setStored(clamp(next));
      },
    } as const,
  };
}
