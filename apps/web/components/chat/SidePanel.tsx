"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { usePaneResize } from "@/lib/usePaneResize";
import { cn } from "@/lib/utils";

const PANEL_WIDTH_KEY = "overtchat:chat-side-panel-width";
const MIN_PANEL_WIDTH = 320;
const MAX_DEFAULT_PANEL_WIDTH = 736;
const MIN_CHAT_WIDTH = 400;

/**
 * The frame of a panel beside the chat: docked beside it on wide screens and
 * full screen otherwise; `overlay` floats it everywhere. A docked panel is
 * resized from its left edge. Escape closes it from anywhere unless something
 * else handles the key.
 */
export function SidePanel({
  variant,
  onClose,
  className,
  style,
  children,
  ...props
}: ComponentProps<"aside"> & { variant: "docked" | "overlay"; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  // Width of the row the panel shares with the chat.
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const docked = variant === "docked";
  const resize = usePaneResize({
    storageKey: PANEL_WIDTH_KEY,
    defaultSize: Math.min(MAX_DEFAULT_PANEL_WIDTH, Math.round((rowWidth ?? 0) * 0.48)),
    minSize: MIN_PANEL_WIDTH,
    maxSize: (rowWidth ?? 0) - MIN_CHAT_WIDTH,
    edge: "left",
  });
  useLayoutEffect(() => {
    const row = ref.current?.parentElement;
    if (!docked || !row) return;
    const measure = () => setRowWidth(row.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [docked]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        target?.closest("[role=dialog]")
      ) {
        return;
      }
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sized = docked && rowWidth !== null;
  return (
    <aside
      {...props}
      ref={ref}
      style={
        sized
          ? ({ ...style, "--side-panel-width": `${resize.size}px` } as CSSProperties)
          : style
      }
      className={cn(
        "@container/panel z-40 flex min-h-0 flex-col bg-background text-foreground",
        docked
          ? "fixed inset-0 lg:relative lg:z-auto lg:w-[var(--side-panel-width,min(46rem,48%))] lg:shrink-0 lg:border-l"
          : "fixed inset-0 lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[min(46rem,60%)] lg:border-l lg:shadow-xl",
        // Frames would take the pointer from the separator mid-drag.
        resize.resizing && "[&_iframe]:pointer-events-none",
        className,
      )}
    >
      {sized && (
        <div
          {...resize.separatorProps}
          aria-label="Resize panel"
          tabIndex={0}
          data-testid="side-panel-resize-handle"
          className="group absolute inset-y-0 -left-1 z-10 hidden w-2 touch-none cursor-col-resize outline-none select-none lg:block"
        >
          <span
            className={cn(
              "absolute inset-y-0 left-1 w-px motion-colors group-hover:bg-primary/70 group-focus-visible:w-0.5 group-focus-visible:bg-primary",
              resize.resizing && "w-0.5 bg-primary",
            )}
          />
        </div>
      )}
      {children}
    </aside>
  );
}

/**
 * The panel's top row. In the desktop app it is part of the titlebar: it
 * drags the window and clears the window controls, also when the panel fills
 * the window on narrow screens.
 */
export function SidePanelHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      {...props}
      data-titlebar
      data-side-panel-header=""
      className={cn("flex min-h-12 shrink-0 items-center gap-2 border-b px-3 py-1", className)}
    />
  );
}
