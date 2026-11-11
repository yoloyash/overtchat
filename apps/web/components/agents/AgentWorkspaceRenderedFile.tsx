"use client";

import { useMemo } from "react";
import { Streamdown } from "streamdown";
import {
  DelimitedTable,
  HtmlFilePreview,
} from "@/components/chat/FilePreviewBodies";
import { svgPreviewSource } from "@/lib/chat/code-preview";
import {
  MESSAGE_MARKDOWN_PLUGINS,
  STREAMDOWN_DEFAULT_REMARK_PLUGINS,
} from "@/lib/chat/markdown";
import {
  remarkWorkspaceFileLinks,
  type WorkspaceFileRendering,
} from "@/lib/agents/workspaceFilePreview";
import { cn } from "@/lib/utils";
import { AgentWorkspaceLink } from "./AgentWorkspaceLink";

const MARKDOWN_ALLOWED_TAGS = { "agent-workspace-link": ["path"] };
const MARKDOWN_COMPONENTS = { "agent-workspace-link": AgentWorkspaceLink };
const MARKDOWN_CLASSES = cn(
  "font-sans space-y-3 text-[15px] leading-relaxed",
  // The theme's link colour is close to body text, so documents underline links.
  "[&_[data-streamdown=link]]:font-medium [&_[data-streamdown=link]]:text-primary",
  "[&_[data-streamdown=link]]:underline [&_[data-workspace-path]]:underline",
  "[&_[data-streamdown=link]]:underline-offset-4 [&_[data-workspace-path]]:underline-offset-4",
  "[&_[data-streamdown=link]]:decoration-muted-foreground/50 [&_[data-workspace-path]]:decoration-muted-foreground/50",
);

/** A workspace text file shown as what it describes instead of its source. */
export function AgentWorkspaceRenderedFile({
  path,
  content,
  rendering,
}: {
  path: string;
  content: string;
  rendering: WorkspaceFileRendering;
}) {
  switch (rendering.kind) {
    case "markdown":
      return <MarkdownFile path={path} content={content} />;
    case "table":
      return (
        <div className="min-h-0 flex-1 overflow-auto">
          <DelimitedTable text={content} delimiter={rendering.delimiter} />
        </div>
      );
    case "html":
      return (
        <div className="min-h-0 flex-1">
          <HtmlFilePreview name={path} html={content} />
        </div>
      );
    case "svg":
      return <SvgFile path={path} content={content} />;
  }
}

function MarkdownFile({ path, content }: { path: string; content: string }) {
  const remarkPlugins = useMemo(
    () => [...STREAMDOWN_DEFAULT_REMARK_PLUGINS, remarkWorkspaceFileLinks(path)],
    [path],
  );
  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      data-testid="agent-workspace-markdown"
    >
      <div className="mx-auto max-w-3xl px-5 py-4">
        <Streamdown
          className={MARKDOWN_CLASSES}
          plugins={MESSAGE_MARKDOWN_PLUGINS}
          remarkPlugins={remarkPlugins}
          allowedTags={MARKDOWN_ALLOWED_TAGS}
          components={MARKDOWN_COMPONENTS}
          mode="static"
        >
          {content}
        </Streamdown>
      </div>
    </div>
  );
}

function SvgFile({ path, content }: { path: string; content: string }) {
  // The drawing is only ever an image source, where scripts and external
  // resources stay disabled.
  const url = useMemo(() => {
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        svgPreviewSource(content),
      )}`;
    } catch {
      return null;
    }
  }, [content]);

  if (url === null) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        This SVG could not be rendered. Its source is still available.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={path}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
