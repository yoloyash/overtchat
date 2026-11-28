"use client";

import { useEffect } from "react";

/**
 * Page-wide motion for the homepage: reveals `[data-reveal]` blocks as they
 * scroll into view and feeds the pointer position to `[data-glow]` surfaces.
 */
export function HomeEffects() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    const waiting: HTMLElement[] = [];
    // Anything already on screen stays put; hiding it now would make it flash.
    for (const block of blocks) {
      if (block.getBoundingClientRect().top < window.innerHeight * 0.9) {
        block.dataset.revealed = "";
      } else {
        waiting.push(block);
      }
    }
    root.classList.add("reveal-ready");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    waiting.forEach((block) => observer.observe(block));

    function trackGlow(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      const surface = event.target.closest<HTMLElement>("[data-glow]");
      if (!surface) return;
      const bounds = surface.getBoundingClientRect();
      surface.style.setProperty("--glow-x", `${event.clientX - bounds.left}px`);
      surface.style.setProperty("--glow-y", `${event.clientY - bounds.top}px`);
    }
    document.addEventListener("pointermove", trackGlow, { passive: true });

    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", trackGlow);
      root.classList.remove("reveal-ready");
      for (const block of blocks) delete block.dataset.revealed;
    };
  }, []);

  return null;
}
