"use client";

import { Streamdown } from "streamdown";
import remarkBreaks from "remark-breaks";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  useStreamdownPlugins,
} from "@/lib/chat/markdown";

const THINKING_REMARK_PLUGINS = [
  ...STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  remarkBreaks,
];

/** Muted markdown rendered inside reasoning and agent-work details. */
export function ThinkingContent({ content }: { content: string }) {
  const plugins = useStreamdownPlugins();
  const trimmed = content.trim();
  if (!trimmed) return null;
  return (
    <Streamdown
      className="space-y-3 text-xs leading-relaxed text-muted-foreground [&_pre]:text-xs [&_code]:text-xs"
      plugins={plugins}
      remarkPlugins={THINKING_REMARK_PLUGINS}
    >
      {trimmed}
    </Streamdown>
  );
}
