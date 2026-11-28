"use client";

import { Streamdown } from "streamdown";
import { useMarkdownLabels } from "@/lib/chat/useMarkdownLabels";
import remarkBreaks from "remark-breaks";
import {
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  STREAMDOWN_PLUGINS,
} from "@/lib/chat/markdown";

const THINKING_REMARK_PLUGINS = [
  ...STREAMDOWN_DEFAULT_REMARK_PLUGINS,
  remarkBreaks,
];

/** Muted markdown rendered inside reasoning and agent-work details. */
export function ThinkingContent({ content }: { content: string }) {
  const markdownLabels = useMarkdownLabels();
  const trimmed = content.trim();
  if (!trimmed) return null;
  return (
    <Streamdown
      translations={markdownLabels}
      className="space-y-3 text-xs leading-relaxed text-muted-foreground [&_pre]:text-xs [&_code]:text-xs"
      plugins={STREAMDOWN_PLUGINS}
      remarkPlugins={THINKING_REMARK_PLUGINS}
    >
      {trimmed}
    </Streamdown>
  );
}
