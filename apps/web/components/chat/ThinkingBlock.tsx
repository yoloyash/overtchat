"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Streamdown } from "streamdown";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";

const THINKING_REMARK_PLUGINS = [
  ...STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  remarkBreaks,
];

export function ThinkingBlock({
  content,
  active,
}: {
  content: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (active) {
      if (startedAtRef.current == null) startedAtRef.current = Date.now();
      settledRef.current = false;
      const tick = () => {
        if (startedAtRef.current != null) {
          setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      };
      tick();
      const id = window.setInterval(tick, 1000);
      return () => window.clearInterval(id);
    }
    if (startedAtRef.current != null && !settledRef.current) {
      settledRef.current = true;
      setDuration(
        Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
    }
  }, [active]);

  const trimmed = content.trim();
  if (!trimmed && !active) return null;

  const label = active
    ? "Thinking…"
    : duration > 0
      ? `Thought for ${duration}s`
      : "Thoughts";

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group/think inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        aria-expanded={open}
      >
        <span className={cn(active && "animate-text-shimmer")}>{label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-l-2 border-border pl-3">
            <Streamdown
              className="space-y-3 text-xs leading-relaxed text-muted-foreground [&_pre]:text-xs [&_code]:text-xs"
              plugins={STREAMDOWN_PLUGINS}
              remarkPlugins={THINKING_REMARK_PLUGINS}
            >
              {trimmed}
            </Streamdown>
          </div>
        </div>
      </div>
    </div>
  );
}
