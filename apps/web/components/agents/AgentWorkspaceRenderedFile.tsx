"use client";

import { useMemo } from "react";
import { Streamdown } from "streamdown";
import type { AgentWorkspaceFilePreview } from "@overtchat/agent-bridge";
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
import { useAgentWorkspaceFile } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";
import { AgentWorkspaceLink } from "./AgentWorkspaceLink";

const MARKDOWN_ALLOWED_TAGS = {
  "agent-workspace-link": ["path"],
  "agent-workspace-image": ["path", "alt"],
};
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
  workspaceId,
  path,
  content,
  rendering,
}: {
  workspaceId: string;
  path: string;
  content: string;
  rendering: WorkspaceFileRendering;
}) {
  switch (rendering.kind) {
    case "markdown":
      return (
        <MarkdownFile workspaceId={workspaceId} path={path} content={content} />
      );
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
    case "svg": {
      const source = svgImageSource(content);
      return source ? (
        <AgentWorkspaceImage path={path} source={source} />
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          This SVG could not be rendered. Its source is still available.
        </p>
      );
    }
  }
}

/** A picture from the workspace, fitted to the pane. */
export function AgentWorkspaceImage({
  path,
  source,
}: {
  path: string;
  source: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/10 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={path}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

// A drawing is only ever an image source, where scripts and external
// resources stay disabled.
function svgImageSource(content: string): string | null {
  try {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      svgPreviewSource(content),
    )}`;
  } catch {
    return null;
  }
}

function imageSource(file: AgentWorkspaceFilePreview | undefined): string | null {
  if (!file) return null;
  return file.kind === "image"
    ? `data:${file.mediaType};base64,${file.content}`
    : svgImageSource(file.content);
}

/** A picture a document embeds from the workspace, by its workspace path. */
function MarkdownImage({
  workspaceId,
  path,
  alt,
}: {
  workspaceId: string;
  path: string;
  alt: string;
}) {
  const file = useAgentWorkspaceFile(workspaceId, path);
  const source = useMemo(() => imageSource(file.data), [file.data]);
  if (!source) {
    return (
      <span className="text-sm text-muted-foreground" title={path}>
        {file.isPending ? "Loading image…" : alt || path}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={alt}
      title={path}
      className="inline-block max-w-full rounded-md"
    />
  );
}

function MarkdownFile({
  workspaceId,
  path,
  content,
}: {
  workspaceId: string;
  path: string;
  content: string;
}) {
  const remarkPlugins = useMemo(
    () => [...STREAMDOWN_DEFAULT_REMARK_PLUGINS, remarkWorkspaceFileLinks(path)],
    [path],
  );
  const components = useMemo(
    () => ({
      "agent-workspace-link": AgentWorkspaceLink,
      "agent-workspace-image": (props: { path?: unknown; alt?: unknown }) =>
        typeof props.path === "string" ? (
          <MarkdownImage
            workspaceId={workspaceId}
            path={props.path}
            alt={typeof props.alt === "string" ? props.alt : ""}
          />
        ) : null,
    }),
    [workspaceId],
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
          components={components}
          mode="static"
        >
          {content}
        </Streamdown>
      </div>
    </div>
  );
}
