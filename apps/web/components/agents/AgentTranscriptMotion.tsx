"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
