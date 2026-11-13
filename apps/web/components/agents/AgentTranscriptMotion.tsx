"use client";

import {
  createContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
  type WheelEvent,
} from "react";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Retain closing content only until its height transition finishes. */
export function AgentTranscriptMotion({ collapsed, children }: {
  collapsed: boolean;
  children: ReactNode;
}) {
  const [retained, setRetained] = useState(!collapsed);
  if (!collapsed && !retained) setRetained(true);
  useEffect(() => {
    if (!collapsed || !retained) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Slightly longer than the shared 180ms transition, including its first paint.
    const timer = window.setTimeout(() => setRetained(false), reduced ? 0 : 240);
    return () => window.clearTimeout(timer);
  }, [collapsed, retained]);
  return (
    <div
      className={cn("group grid", motionClasses.collapse,
        collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}
      inert={collapsed}
      aria-hidden={collapsed || undefined}
      data-transcript-collapsed={collapsed || undefined}
      data-transcript-row="true"
    >
      <div className="min-h-0 overflow-hidden">
        {!collapsed || retained ? children : null}
      </div>
    </div>
  );
}

/** Rows pass the control that was pressed, before they change height. */
export const AgentDisclosureContext = createContext<(control: HTMLElement) => void>(
  () => {},
);

const UP_KEYS = new Set(["PageUp", "ArrowUp", "Home"]);
// Wide enough for an overlay scrollbar, which takes no layout space.
const SCROLLBAR_HIT_PX = 16;

/**
 * Whether upward input at `target` moves the viewport. With nowhere to go the
 * view would stop following and never see the scroll that resumes it; a nested
 * pane that can still scroll up keeps the input for itself.
 */
function scrollsViewportUp(target: EventTarget | null, viewport: HTMLElement): boolean {
  if (viewport.scrollTop <= 0) return false;
  if (!(target instanceof Element) || !viewport.contains(target)) return true;
  for (
    let element: Element | null = target;
    element && element !== viewport;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
    if (
      element.scrollTop > 0 ||
      style.overscrollBehaviorY === "contain" ||
      style.overscrollBehaviorY === "none"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Stop following new content the moment the reader reaches for older content.
 * Position cannot tell the reader's scroll from content growing beneath it, so
 * this reads the input itself, wherever in the transcript it lands.
 */
export function useAgentScrollRelease(
  viewportRef: { readonly current: HTMLElement | null },
  release: () => void,
) {
  const touchStart = useRef<number | null>(null);
  // Clicking transcript text leaves focus on the page body, and its scroll
  // keys still move the transcript, so they are heard on the document.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const viewport = viewportRef.current;
      const target = event.target;
      if (!viewport || !(target instanceof Element) || !UP_KEYS.has(event.key)) return;
      if (
        event.defaultPrevented || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      ) {
        return;
      }
      if (
        !viewport.contains(target) &&
        target !== document.body &&
        target !== document.documentElement
      ) {
        return;
      }
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (scrollsViewportUp(target, viewport)) release();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewportRef, release]);
  return {
    onWheel: (event: WheelEvent<HTMLElement>) => {
      if (
        event.deltaY < 0 && !event.ctrlKey &&
        scrollsViewportUp(event.target, event.currentTarget)
      ) {
        release();
      }
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      touchStart.current = event.touches[0]?.clientY ?? null;
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      const y = event.touches[0]?.clientY;
      if (
        touchStart.current !== null && y !== undefined && y - touchStart.current > 8 &&
        scrollsViewportUp(event.target, event.currentTarget)
      ) {
        release();
      }
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const viewport = event.currentTarget;
      // Scrollbar drags produce no wheel or touch input. The viewport's own
      // gutters target it too, so only a press at its trailing edge counts.
      const scrollbar = Math.max(SCROLLBAR_HIT_PX, viewport.offsetWidth - viewport.clientWidth);
      if (
        event.target === viewport &&
        viewport.getBoundingClientRect().right - event.clientX <= scrollbar &&
        viewport.scrollTop > 0
      ) {
        release();
      }
    },
  };
}

/** Keep the clicked disclosure steady while surrounding row heights settle. */
export function useAgentDisclosureAnchor() {
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  return (button: HTMLElement, viewport: HTMLElement | null) => {
    cancel.current?.();
    if (!viewport) return;
    const top = button.getBoundingClientRect().top;
    const deadline = performance.now() + 280;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        viewport.removeEventListener(event, stop);
      }
      cancel.current = null;
    };
    const pin = () => {
      if (!button.isConnected) return stop();
      const delta = button.getBoundingClientRect().top - top;
      if (Math.abs(delta) > 0.5) viewport.scrollTop += delta;
      if (performance.now() < deadline) frame = requestAnimationFrame(pin);
      else stop();
    };
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      viewport.addEventListener(event, stop, { passive: true });
    }
    cancel.current = stop;
    frame = requestAnimationFrame(pin);
  };
}
