"use client";

import { Streamdown } from "streamdown";
import remarkBreaks from "remark-breaks";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";

const THINKING_REMARK_PLUGINS = [
  ...STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  remarkBreaks,
];

/** A reasoning part's markdown, rendered as muted text inside a ChainOfThought step. */
export function ThinkingContent({ content }: { content: string }) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return (
    <Streamdown
      className="space-y-3 text-xs leading-relaxed text-muted-foreground [&_pre]:text-xs [&_code]:text-xs"
      plugins={STREAMDOWN_PLUGINS}
      remarkPlugins={THINKING_REMARK_PLUGINS}
    >
      {trimmed}
    </Streamdown>
  );
}
